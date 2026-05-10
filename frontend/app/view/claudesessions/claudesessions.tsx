// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import claudeCodeIconUrl from "@/app/asset/claudecode-color.svg?url";
import type { ViewComponentProps } from "@/app/block/blocktypes";
import { keydownWrapper } from "@/util/keyutil";
import clsx from "clsx";
import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import { useEffect, useRef } from "react";
import type { ClaudeSessionsViewModel } from "./claudesessions-model";

function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
}

function getDateGroup(timestamp: number): string {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const weekStart = todayStart - 6 * 86400000;

    if (timestamp >= todayStart) return "Today";
    if (timestamp >= yesterdayStart) return "Yesterday";
    if (timestamp >= weekStart) return "Last 7 Days";
    return "Older";
}

function groupSessionsByDate(sessions: ClaudeSessionInfo[]): Map<string, ClaudeSessionInfo[]> {
    const groups = new Map<string, ClaudeSessionInfo[]>();
    const order = ["Today", "Yesterday", "Last 7 Days", "Older"];
    for (const key of order) {
        groups.set(key, []);
    }
    for (const session of sessions) {
        const group = getDateGroup(session.lasttimestamp);
        groups.get(group).push(session);
    }
    for (const [key, val] of groups) {
        if (val.length === 0) groups.delete(key);
    }
    return groups;
}

const SessionItem = React.memo(function SessionItem({
    session,
    isSelected,
    onClick,
}: {
    session: ClaudeSessionInfo;
    isSelected: boolean;
    onClick: () => void;
}) {
    const itemRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isSelected && itemRef.current) {
            itemRef.current.scrollIntoView({ block: "nearest" });
        }
    }, [isSelected]);

    const displayMsg = (session.lastmsg || session.firstmsg || "(no message)").split("\n")[0];

    return (
        <div
            ref={itemRef}
            onClick={onClick}
            className={clsx(
                "flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors duration-100 border-b border-white/5",
                isSelected ? "bg-white/10" : "hover:bg-white/5"
            )}
        >
            <div className="flex-shrink-0 relative">
                <div className="w-6 h-6 rounded-full bg-[#D97757]/15 flex items-center justify-center">
                    <img src={claudeCodeIconUrl} className="w-3.5 h-3.5" />
                </div>
                {session.isactive && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 border border-[#1e1e2e]" />
                )}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-[13px] text-white truncate">{displayMsg}</div>
                <div className="flex items-center gap-1.5 mt-px">
                    <span className="text-[11px] text-white/40 truncate">{session.projectname || "unknown"}</span>
                    <span className="text-[11px] text-white/25 flex-shrink-0">·</span>
                    <span className="text-[11px] text-white/30 flex-shrink-0">{formatRelativeTime(session.lasttimestamp)}</span>
                    {session.isactive && <span className="text-[10px] text-green-400 font-medium flex-shrink-0">Active</span>}
                </div>
            </div>
        </div>
    );
});
SessionItem.displayName = "SessionItem";

export function ClaudeSessionsView({ blockId, model }: ViewComponentProps<ClaudeSessionsViewModel>) {
    const [searchTerm, setSearchTerm] = useAtom(model.searchTermAtom);
    const [selectedIndex, setSelectedIndex] = useAtom(model.selectedIndexAtom);
    const filteredSessions = useAtomValue(model.filteredSessionsAtom);
    const loading = useAtomValue(model.loadingAtom);
    const error = useAtomValue(model.errorAtom);

    useEffect(() => {
        setSelectedIndex(0);
    }, [searchTerm]);

    const grouped = React.useMemo(() => groupSessionsByDate(filteredSessions), [filteredSessions]);

    let flatIndex = 0;

    return (
        <div className="flex flex-col h-full w-full bg-[#1e1e2e]">
            <div className="px-2 py-1.5 border-b border-white/10 flex-shrink-0">
                <div className="flex items-center gap-2 bg-white/5 rounded px-2 py-1">
                    <i className="fa-solid fa-magnifying-glass text-white/30 text-[10px]" />
                    <input
                        ref={model.inputRef}
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={keydownWrapper(model.keyDownHandler.bind(model))}
                        placeholder="Search..."
                        className="bg-transparent border-none outline-none text-xs text-white placeholder-white/30 w-full"
                    />
                    {searchTerm && (
                        <i
                            className="fa-solid fa-xmark text-white/30 text-[10px] cursor-pointer hover:text-white/60"
                            onClick={() => {
                                setSearchTerm("");
                                setSelectedIndex(0);
                            }}
                        />
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {error && (
                    <div className="px-3 py-2 text-red-400 text-xs">
                        <i className="fa-solid fa-triangle-exclamation mr-1" />
                        {error}
                    </div>
                )}

                {!error && filteredSessions.length === 0 && !loading && (
                    <div className="flex flex-col items-center justify-center h-full text-white/30">
                        <i className="fa-solid fa-messages text-2xl mb-2" />
                        <div className="text-xs">No Claude sessions found</div>
                    </div>
                )}

                {Array.from(grouped.entries()).map(([groupName, sessions]) => (
                    <div key={groupName}>
                        <div className="px-3 py-1 text-[10px] font-semibold text-white/40 uppercase tracking-wider bg-white/[0.02] sticky top-0 z-10">
                            {groupName}
                        </div>
                        {sessions.map((session) => {
                            const currentFlatIndex = flatIndex++;
                            return (
                                <SessionItem
                                    key={session.sessionid}
                                    session={session}
                                    isSelected={currentFlatIndex === selectedIndex}
                                    onClick={() => {
                                        setSelectedIndex(currentFlatIndex);
                                        model.openSession(session);
                                    }}
                                />
                            );
                        })}
                    </div>
                ))}

                {loading && filteredSessions.length === 0 && (
                    <div className="flex items-center justify-center h-full text-white/30">
                        <i className="fa-solid fa-spinner fa-spin text-lg" />
                    </div>
                )}
            </div>

            <div className="px-3 py-1 border-t border-white/10 text-[10px] text-white/30 flex items-center justify-between flex-shrink-0">
                <span>{filteredSessions.length} sessions</span>
                <span>
                    <kbd className="px-1 bg-white/10 rounded text-[9px]">↑↓</kbd>{" "}
                    <kbd className="px-1 bg-white/10 rounded text-[9px]">↵</kbd> Open
                </span>
            </div>
        </div>
    );
}
