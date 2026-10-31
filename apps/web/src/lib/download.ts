"use client";

import { api } from "./api";
import type { ArtifactLink } from "./types";

/** Signed URLs live 15 minutes, so a fresh one is requested on every click. */
export async function openArtifact(runId: string, kind: "docx" | "pdf"): Promise<void> {
  const link = await api.get<ArtifactLink>(`/runs/${runId}/${kind}`);
  window.open(link.url, "_blank", "noopener");
}
