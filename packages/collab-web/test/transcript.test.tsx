import { describe, expect, it } from "bun:test";
import type { AssistantMessage, SessionEntry } from "@oh-my-pi/pi-wire";
import { renderToStaticMarkup } from "react-dom/server";
import "./transcript-dom-shim";
import {
	followTranscriptTail,
	Transcript,
	updateTranscriptTailLock,
} from "../src/components/transcript/Transcript";
import type { ActiveTool } from "../src/lib/client";

const TOOL_CALL_ID = "call-running-tool";
const TOOL_NAME = "probe_tool";

const RAW_ASSISTANT_TARGET = "stale-raw-assistant-target";
const ACTIVE_TOOL_TARGET = "effective-active-tool-target";

function assistantUsage(): AssistantMessage["usage"] {
	return { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { total: 0 } };
}

function committedAssistantToolCall(): SessionEntry {
	return {
		type: "message",
		id: "assistant-entry-1",
		parentId: null,
		timestamp: "2026-07-09T00:00:00Z",
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: "I will run the tool." },
				{
					type: "toolCall",
					id: TOOL_CALL_ID,
					name: TOOL_NAME,
					arguments: { target: RAW_ASSISTANT_TARGET },
					intent: "Inspect fixture input",
				},
			],
			model: "test/model",
			usage: assistantUsage(),
			stopReason: "stop",
			timestamp: 1,
		},
	};
}

function activeTool(): ActiveTool {
	return {
		toolCallId: TOOL_CALL_ID,
		toolName: TOOL_NAME,
		args: { target: ACTIVE_TOOL_TARGET },
		intent: "Inspect fixture input",
		startedAt: 1,
	};
}

function renderTranscript(props: {
	entries?: readonly SessionEntry[];
	activeTools?: ReadonlyMap<string, ActiveTool>;
	working: boolean;
}): string {
	return renderToStaticMarkup(
		<Transcript
			entries={props.entries ?? []}
			stream={null}
			streamDone={true}
			activeTools={props.activeTools ?? new Map()}
			working={props.working}
		/>,
	);
}

function countElements(html: string, selector: string): number {
	let count = 0;
	new HTMLRewriter()
		.on(selector, {
			element() {
				count++;
			},
		})
		.transform(html);
	return count;
}

function countOccurrences(text: string, needle: string): number {
	let count = 0;
	let start = 0;
	while (true) {
		const index = text.indexOf(needle, start);
		if (index === -1) return count;
		count++;
		start = index + needle.length;
	}
}

describe("Transcript live tool rendering", () => {
	it("renders one running card for a committed tool call using active args without the working shimmer", () => {
		const html = renderTranscript({
			entries: [committedAssistantToolCall()],
			activeTools: new Map([[TOOL_CALL_ID, activeTool()]]),
			working: true,
		});

		expect(countElements(html, ".tv-card")).toBe(1);
		expect(countElements(html, '[aria-label="running"]')).toBe(1);
		expect(countOccurrences(html, TOOL_NAME)).toBe(1);
		expect(html).not.toContain("thinking…");
		expect(html).toContain(ACTIVE_TOOL_TARGET);
		expect(html).not.toContain(RAW_ASSISTANT_TARGET);
	});

	it("keeps the working shimmer when no tool is active", () => {
		const html = renderTranscript({ working: true, activeTools: new Map() });

		expect(html).toContain("thinking…");
	});
});

describe("Transcript message Markdown", () => {
	it("renders host strings and guest text blocks as Markdown", () => {
		const entries: SessionEntry[] = [
			{
				type: "message",
				id: "host-markdown",
				parentId: null,
				timestamp: "2026-07-15T00:00:00Z",
				message: {
					role: "user",
					content: "Use `381866285601915778`",
					timestamp: 1,
				},
			},
			{
				type: "custom_message",
				id: "guest-markdown",
				parentId: "host-markdown",
				timestamp: "2026-07-15T00:00:01Z",
				customType: "collab-prompt",
				content: [{ type: "text", text: "Guest uses **Markdown**" }],
				details: { from: "guest" },
				display: true,
			},
		];

		const html = renderTranscript({ entries, working: false });

		expect(countElements(html, ".tr-row--user .tr-md code")).toBe(1);
		expect(countElements(html, ".tr-row--user .tr-md strong")).toBe(1);
	});
});

describe("Transcript metadata disclosures", () => {
	it("keeps host prose, guest attribution and attachments visible while metadata bodies stay unmounted", () => {
		const entries: SessionEntry[] = [
			{
				type: "message",
				id: "host-metadata",
				parentId: null,
				timestamp: "2026-07-15T00:00:00Z",
				message: {
					role: "user",
					content: [
						{ type: "text", text: "before <irc>private-irc-payload</irc> after" },
						{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
						{ type: "text", text: "attachment-tail" },
					],
					timestamp: 1,
				},
			},
			{
				type: "custom_message",
				id: "guest-metadata",
				parentId: "host-metadata",
				timestamp: "2026-07-15T00:00:01Z",
				customType: "collab-prompt",
				content: "guest prose <system-notice>private-notice-payload</system-notice> guest tail",
				details: { from: "alice" },
				display: true,
			},
		];
		const html = renderTranscript({ entries, working: false });

		expect(countElements(html, 'button[aria-expanded="false"]')).toBe(2);
		expect(html).not.toContain("private-irc-payload");
		expect(html).not.toContain("private-notice-payload");
		expect(html).toContain("alice");
		expect(html).toContain("guest prose");
		expect(html).toContain("guest tail");
		expect(html.indexOf("before")).toBeLessThan(html.indexOf("aria-expanded"));
		expect(html.indexOf("aria-expanded")).toBeLessThan(html.indexOf("after"));
		expect(html.indexOf("after")).toBeLessThan(html.indexOf("data:image/png;base64,aW1hZ2U="));
		expect(html.indexOf("data:image/png;base64,aW1hZ2U=")).toBeLessThan(html.indexOf("attachment-tail"));
	});

	it("lazily collapses displayed custom metadata and honors hidden custom and collab-prompt entries", () => {
		const entries: SessionEntry[] = [
			{
				type: "custom_message",
				id: "custom-irc",
				parentId: null,
				timestamp: "2026-07-15T00:00:00Z",
				customType: "irc:incoming",
				content: [{ type: "text", text: "custom-irc-payload" }],
				display: true,
			},
			...["collab-prompt", "hidden-metadata"].map(
				(customType): SessionEntry => ({
					type: "custom_message",
					id: customType,
					parentId: "custom-irc",
					timestamp: "2026-07-15T00:00:01Z",
					customType,
					content: "hidden-custom-payload",
					display: false,
				}),
			),
		];
		const html = renderTranscript({ entries, working: false });

		expect(countElements(html, ".tr-row--custom")).toBe(1);
		expect(countElements(html, ".tr-row--user")).toBe(0);
		expect(countElements(html, 'button[aria-expanded="false"]')).toBe(1);
		expect(html).not.toContain("custom-irc-payload");
		expect(html).not.toContain("hidden-custom-payload");
	});
});

describe("Transcript tail-follow scroll operations", () => {
	it("restores tail-follow when a connection becomes live", () => {
		const element = { scrollTop: 0, scrollHeight: 1_000, clientHeight: 200 };
		const lock = { current: false };

		followTranscriptTail(element, lock, true);
		expect(lock.current).toBe(true);
		expect(element.scrollTop).toBe(1_000);

		element.scrollTop = 600;
		updateTranscriptTailLock(element, lock);
		expect(lock.current).toBe(false);

		element.scrollHeight = 1_200;
		followTranscriptTail(element, lock);
		expect(element.scrollTop).toBe(600);

		followTranscriptTail(element, lock, true);
		expect(lock.current).toBe(true);
		expect(element.scrollTop).toBe(1_200);
	});
});

describe("Transcript windowing", () => {
	it("mounts only the newest 100 entries and offers the rest", () => {
		const entries: SessionEntry[] = Array.from({ length: 250 }, (_, i) => ({
			type: "message",
			id: `m${i}`,
			parentId: i === 0 ? null : `m${i - 1}`,
			timestamp: "2026-07-15T00:00:00Z",
			message: { role: "user", content: `message-${i}-end`, timestamp: i },
		}));

		const html = renderTranscript({ entries, working: false });

		expect(countElements(html, ".tr-row--user")).toBe(100);
		expect(html).toContain("message-249-end");
		expect(html).toContain("message-150-end");
		expect(html).not.toContain("message-149-end");
		expect(html).toContain("show 150 earlier");
	});
});
