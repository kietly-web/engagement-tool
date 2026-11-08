import { describe, expect, it } from "vitest";
import { DemoChatSource } from "./demo-chat";

describe("DemoChatSource", () => {
  it("serves deterministic synthetic pages without author extras", async () => {
    const a = new DemoChatSource(1);
    const p1 = await a.fetchPage("demo");
    expect(p1.nextPageToken).toBe("1");
    expect(p1.messages.length).toBeGreaterThan(0);
    expect(Object.keys(p1.messages[0]!).sort()).toEqual(["channelId", "displayName", "publishedAt", "text"]);
    expect(await new DemoChatSource(1).fetchPage("demo")).toEqual(p1);
    expect((await a.fetchPage("demo", "1")).messages).not.toEqual(p1.messages);
  });
});
