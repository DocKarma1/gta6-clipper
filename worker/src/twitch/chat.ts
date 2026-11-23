/**
 * Placeholder for Twitch chat ingest (IRC and/or EventSub channel.chat.message).
 * Official APIs only. Read-only: this worker should not send chat messages.
 */
export type ChatEvent = {
  streamId: string;
  userId: string;
  text: string;
  emoteIds: string[];
  receivedAt: string;
};

export async function startChatIngest(_streamId: string): Promise<void> {
  throw new Error("Chat ingest is not implemented. See docs/PROJECT_PLAN.md Phase 2.");
}
