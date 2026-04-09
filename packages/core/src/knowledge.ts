import crypto from "node:crypto";
import { sanitizeUntrustedText } from "./security.js";
import type { RepositoryDocument, RepositoryKnowledgeChunk } from "./types.js";

const DOUBLE_STAR_TOKEN = "__PATCHPACT_DOUBLE_STAR__";
const DEFAULT_CHUNK_SIZE = 900;
const DEFAULT_CHUNK_OVERLAP = 120;

export function globToRegExp(pattern: string): RegExp {
  return new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, DOUBLE_STAR_TOKEN)
        .replace(/\*/g, "[^/]*")
        .replace(new RegExp(DOUBLE_STAR_TOKEN, "g"), ".*") +
      "$",
  );
}

export function matchesAnyGlob(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

export function filterRepositoryDocuments(
  documents: RepositoryDocument[],
  globs: string[],
): RepositoryDocument[] {
  return documents.filter((document) => matchesAnyGlob(document.path, globs));
}

export function extractKnowledgeQuery(text: string): string {
  const terms = sanitizeUntrustedText(text)
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/i)
    .filter((term) => term.length >= 3);
  return [...new Set(terms)].slice(0, 12).join(" ");
}

export function chunkRepositoryDocuments(
  documents: RepositoryDocument[],
): Array<{
  path: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
}> {
  const chunks: Array<{
    path: string;
    chunkIndex: number;
    content: string;
    contentHash: string;
  }> = [];

  for (const document of documents) {
    const normalized = sanitizeUntrustedText(document.content);
    if (!normalized) {
      continue;
    }

    let chunkIndex = 0;
    for (let start = 0; start < normalized.length; start += DEFAULT_CHUNK_SIZE - DEFAULT_CHUNK_OVERLAP) {
      const content = normalized.slice(start, start + DEFAULT_CHUNK_SIZE).trim();
      if (!content) {
        continue;
      }
      chunks.push({
        path: document.path,
        chunkIndex,
        content,
        contentHash: crypto
          .createHash("sha256")
          .update(`${document.path}:${chunkIndex}:${content}`)
          .digest("hex"),
      });
      chunkIndex += 1;
      if (start + DEFAULT_CHUNK_SIZE >= normalized.length) {
        break;
      }
    }
  }

  return chunks;
}

export function mergeKnowledgeIntoDocuments(
  baseDocuments: RepositoryDocument[],
  knowledgeChunks: RepositoryKnowledgeChunk[],
): RepositoryDocument[] {
  const seen = new Set(baseDocuments.map((document) => `${document.path}:${document.content}`));
  const merged = [...baseDocuments];

  for (const chunk of knowledgeChunks) {
    const candidate = {
      path: `${chunk.path}#chunk-${chunk.chunkIndex}`,
      content: chunk.content,
    };
    const key = `${candidate.path}:${candidate.content}`;
    if (!seen.has(key)) {
      merged.push(candidate);
      seen.add(key);
    }
  }

  return merged;
}
