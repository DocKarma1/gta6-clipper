import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseIrcLine } from "./irc";

describe("parseIrcLine", () => {
  it("parses a PRIVMSG and ignores non-chat lines", () => {
    const event = parseIrcLine(
      ":CoolUser!cooluser@cooluser.tmi.twitch.tv PRIVMSG #OhnePixel :CLIP IT LUL",
    );
    assert.ok(event);
    assert.equal(event.channelLogin, "ohnepixel");
    assert.equal(event.userLogin, "cooluser");
    assert.equal(event.text, "CLIP IT LUL");
    assert.equal(parseIrcLine("PING :tmi.twitch.tv"), undefined);
  });

  it("extracts emote ids from IRCv3 tags", () => {
    const event = parseIrcLine(
      "@badge-info=;emotes=25:0-3,5-8/1902:10-13 :x!x@x.tmi.twitch.tv PRIVMSG #alpha :LUL LUL KEKW",
    );
    assert.ok(event);
    assert.deepEqual(event.emoteTokens, ["25", "1902"]);
  });
});
