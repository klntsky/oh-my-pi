import { describe, expect, it } from "bun:test";
import { splitMessageMetadata } from "../src/components/transcript/metadata";

describe("transcript metadata boundaries", () => {
	it("separates attributed IRC and task results without swallowing surrounding prose", () => {
		const irc = '<irc from="parent" agent="Main">parent payload</irc>';
		const task = '<task-result id="a" status="completed"><output>result</output></task-result>';
		const parts = splitMessageMetadata(`before ${irc} between ${task} after`);

		expect(parts).toEqual([
			{ type: "text", text: "before " },
			{ type: "metadata", tag: "irc", text: irc },
			{ type: "text", text: " between " },
			{ type: "metadata", tag: "task-result", text: task },
			{ type: "text", text: " after" },
		]);
	});

	it("keeps nested notices in one recoverable outer envelope", () => {
		const parts = splitMessageMetadata(
			'<system-notice reason="background"><system-reminder>nested</system-reminder>tail</system-notice>visible',
		);

		expect(parts).toEqual([
			{
				type: "metadata",
				tag: "system-notice",
				text: '<system-notice reason="background"><system-reminder>nested</system-reminder>tail</system-notice>',
			},
			{ type: "text", text: "visible" },
		]);
	});

	it.each([
		["backtick fences", "````xml\n<irc>example</irc>\n```\nstill code\n````"],
		["tilde fences", "~~~xml\n<system-notice>example</system-notice>\n~~~"],
		["quoted tilde fences", "> ~~~xml\n> <system-notice>example</system-notice>\n> ~~~"],
		["list-nested tilde fences", "- ~~~xml\n  <system-notice>example</system-notice>\n  ~~~"],
		["unclosed fences", "```xml\n<irc>example</irc>"],
		["multi-backtick spans", "``use `<irc>example</irc>` here``"],
		["indented code", "    <irc>example</irc>"],
		["escaped openers", "\\<irc>example</irc>"],
		["quoted HTML attributes", '<div title="<irc>example</irc>">ordinary HTML</div>'],
		["HTML comments", "<!-- <irc>example</irc> -->"],
		["unknown system tags", "<system-conventions>ordinary prose</system-conventions>"],
		["unclosed envelopes", "<irc>incomplete <system-reminder>nested</system-reminder>"],
		["crossed envelopes", "<irc><system-notice>broken</irc></system-notice>"],
		["malformed attributes", '<irc from="unterminated>example</irc>'],
	])("does not hide %s", (_boundary, text) => {
		expect(splitMessageMetadata(text).filter(part => part.type === "metadata")).toEqual([]);
	});

	it("bounds nested-quote scanning and preserves prose before a real envelope", () => {
		const quoted = `${"> ".repeat(128)}ordinary quoted text\n`;
		const start = performance.now();
		const parts = splitMessageMetadata(`${quoted}<irc>payload</irc>tail`);

		expect(performance.now() - start).toBeLessThan(1_000);
		expect(parts).toEqual([
			{ type: "text", text: quoted },
			{ type: "metadata", tag: "irc", text: "<irc>payload</irc>" },
			{ type: "text", text: "tail" },
		]);
	});

	it("resumes envelope detection after code without moving the code or trailing text", () => {
		const code = "`<irc>example</irc>`\n~~~xml\n<system-notice>example</system-notice>\n~~~\n";
		const parts = splitMessageMetadata(`${code}<system-reminder>real</system-reminder>tail`);

		expect(parts.map(part => part.type)).toEqual(["text", "metadata", "text"]);
		expect(parts[0]?.text).toBe(code);
		expect(parts[1]).toEqual({
			type: "metadata",
			tag: "system-reminder",
			text: "<system-reminder>real</system-reminder>",
		});
		expect(parts[2]?.text).toBe("tail");
	});
});
