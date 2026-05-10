// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { createBlock, globalStore } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import * as jotai from "jotai";
import { ClaudeSessionsView } from "./claudesessions";

const PollIntervalMs = 5000;
const MaxSessions = 50;

export class ClaudeSessionsViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    viewIcon = jotai.atom("messages");
    viewName = jotai.atom("Claude Sessions");
    viewComponent = ClaudeSessionsView;
    noPadding = jotai.atom(true);

    sessionsAtom: jotai.PrimitiveAtom<ClaudeSessionInfo[]>;
    selectedIndexAtom: jotai.PrimitiveAtom<number>;
    searchTermAtom: jotai.PrimitiveAtom<string>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;
    errorAtom: jotai.PrimitiveAtom<string>;

    filteredSessionsAtom: jotai.Atom<ClaudeSessionInfo[]>;
    viewText: jotai.Atom<HeaderElem[]>;

    inputRef = { current: null } as React.RefObject<HTMLInputElement>;
    private pollTimer: ReturnType<typeof setInterval> = null;

    constructor({ blockId, nodeModel }: ViewModelInitType) {
        this.viewType = "claudesessions";
        this.blockId = blockId;
        this.nodeModel = nodeModel;

        this.sessionsAtom = jotai.atom<ClaudeSessionInfo[]>([]);
        this.selectedIndexAtom = jotai.atom<number>(0);
        this.searchTermAtom = jotai.atom<string>("");
        this.loadingAtom = jotai.atom<boolean>(true);
        this.errorAtom = jotai.atom<string>("");

        this.filteredSessionsAtom = jotai.atom((get) => {
            const sessions = get(this.sessionsAtom);
            const search = get(this.searchTermAtom).toLowerCase();
            if (!search) return sessions;
            return sessions.filter(
                (s) =>
                    s.projectname?.toLowerCase().includes(search) ||
                    s.firstmsg?.toLowerCase().includes(search) ||
                    s.project?.toLowerCase().includes(search)
            );
        });

        this.viewText = jotai.atom((get) => {
            const sessions = get(this.sessionsAtom);
            const loading = get(this.loadingAtom);
            const rtn: HeaderElem[] = [];
            rtn.push({
                elemtype: "iconbutton",
                icon: loading ? "spinner" : "rotate-right",
                title: "Refresh",
                iconSpin: loading,
                click: () => this.fetchSessions(),
            });
            rtn.push({
                elemtype: "text",
                text: `${sessions.length} sessions`,
                noGrow: true,
            });
            return rtn;
        });

        this.fetchSessions();
        this.pollTimer = setInterval(() => this.fetchSessions(), PollIntervalMs);
    }

    async fetchSessions() {
        try {
            globalStore.set(this.loadingAtom, true);
            const sessions = await RpcApi.ClaudeSessionsListCommand(TabRpcClient, { timeout: 5000 });
            globalStore.set(this.sessionsAtom, sessions ?? []);
            globalStore.set(this.errorAtom, "");
        } catch (e) {
            globalStore.set(this.errorAtom, String(e));
        } finally {
            globalStore.set(this.loadingAtom, false);
        }
    }

    async openSession(session: ClaudeSessionInfo) {
        const cwd = session.project || session.cwd || "~";
        const resumeCmd = `claude --resume "${session.sessionid}"`;
        await createBlock({
            meta: {
                view: "term",
                controller: "shell",
                "cmd:cwd": cwd,
                "cmd:runonstart": true,
                "cmd:runonce": resumeCmd,
            },
        });
    }

    giveFocus(): boolean {
        if (this.inputRef.current) {
            this.inputRef.current.focus();
            return true;
        }
        return false;
    }

    keyDownHandler(e: WaveKeyboardEvent): boolean {
        const filtered = globalStore.get(this.filteredSessionsAtom);
        const selectedIndex = globalStore.get(this.selectedIndexAtom);

        if (checkKeyPressed(e, "ArrowUp")) {
            if (selectedIndex > 0) {
                globalStore.set(this.selectedIndexAtom, selectedIndex - 1);
            }
            return true;
        }
        if (checkKeyPressed(e, "ArrowDown")) {
            if (selectedIndex < filtered.length - 1) {
                globalStore.set(this.selectedIndexAtom, selectedIndex + 1);
            }
            return true;
        }
        if (checkKeyPressed(e, "Enter")) {
            if (filtered[selectedIndex]) {
                this.openSession(filtered[selectedIndex]);
            }
            return true;
        }
        if (checkKeyPressed(e, "Escape")) {
            globalStore.set(this.searchTermAtom, "");
            globalStore.set(this.selectedIndexAtom, 0);
            return true;
        }
        return false;
    }

    dispose() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }
}
