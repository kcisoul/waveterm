// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import claudeCodeIconUrl from "@/app/asset/claudecode-color.svg?url";
import type { BlockNodeModel } from "@/app/block/blocktypes";
import { createBlock, globalStore } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { stringToBase64 } from "@/util/util";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { checkKeyPressed } from "@/util/keyutil";
import * as jotai from "jotai";
import * as React from "react";
import { ClaudeSessionsView } from "./claudesessions";

export class ClaudeSessionsViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    viewIcon = jotai.atom<IconButtonDecl>({
        elemtype: "iconbutton",
        icon: React.createElement("img", {
            src: claudeCodeIconUrl,
            className: "w-3.5 h-3.5",
            alt: "Claude Code",
        }),
        noAction: true,
    });
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
    private eventUnsub: () => void = null;
    private handleVisibility: () => void = null;

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
                    s.lastmsg?.toLowerCase().includes(search) ||
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

        this.eventUnsub = waveEventSubscribeSingle({
            eventType: "claude:sessions",
            handler: () => this.fetchSessions(),
        });

        this.handleVisibility = () => {
            if (document.visibilityState === "visible") {
                this.fetchSessions();
            }
        };
        document.addEventListener("visibilitychange", this.handleVisibility);
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
        const blockId = await createBlock({
            meta: {
                view: "term",
                controller: "shell",
                "cmd:cwd": cwd,
            },
        });
        const cmd = `claude --resume "${session.sessionid}"\n`;
        setTimeout(() => {
            RpcApi.ControllerInputCommand(TabRpcClient, {
                blockid: blockId,
                inputdata64: stringToBase64(cmd),
            });
        }, 500);
    }

    giveFocus(): boolean {
        if (this.inputRef.current) {
            this.inputRef.current.focus();
        }
        return true;
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
        if (this.eventUnsub) {
            this.eventUnsub();
        }
        if (this.handleVisibility) {
            document.removeEventListener("visibilitychange", this.handleVisibility);
        }
    }
}
