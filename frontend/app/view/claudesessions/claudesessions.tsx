// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

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
    const date = new Date(timestamp);
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
    flatIndex,
    onClick,
}: {
    session: ClaudeSessionInfo;
    isSelected: boolean;
    flatIndex: number;
    onClick: () => void;
}) {
    const itemRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isSelected && itemRef.current) {
            itemRef.current.scrollIntoView({ block: "nearest" });
        }
    }, [isSelected]);

    const firstLine = session.firstmsg?.split("\n")[0] || "(no message)";
    const displayMsg = firstLine.length > 80 ? firstLine.slice(0, 80) + "..." : firstLine;

    return (
        <div
            ref={itemRef}
            onClick={onClick}
            className={clsx(
                "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors duration-100 border-b border-white/5",
                isSelected ? "bg-white/10" : "hover:bg-white/5"
            )}
        >
            <div className="flex-shrink-0 mt-1 relative">
                <div className="w-8 h-8 rounded-full bg-[#7c5aed]/20 flex items-center justify-center">
                    <i className="fa-solid fa-folder text-[#7c5aed] text-xs" />
                </div>
                {session.isactive && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-[#1e1e2e]" />
                )}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white truncate">
                        {session.projectname || "Unknown Project"}
                    </span>
                    <span className="text-[11px] text-white/40 flex-shrink-0">
                        {formatRelativeTime(session.lasttimestamp)}
                    </span>
                </div>
                <div className="text-xs text-white/50 truncate mt-0.5">{displayMsg}</div>
                <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-white/30">
                        {session.msgcount} {session.msgcount === 1 ? "msg" : "msgs"}
                    </span>
                    {session.isactive && <span className="text-[10px] text-green-400 font-medium">Active</span>}
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
        <div className="flex flex-col h-full bg-[#1e1e2e]">
            {/* Search bar */}
            <div className="px-3 py-2 border-b border-white/10">
                <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-1.5">
                    <i className="fa-solid fa-magnifying-glass text-white/30 text-xs" />
                    <input
                        ref={model.inputRef}
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={keydownWrapper(model.keyDownHandler.bind(model))}
                        placeholder="Search sessions..."
                        className="bg-transparent border-none outline-none text-sm text-white placeholder-white/30 w-full"
                    />
                    {searchTerm && (
                        <i
                            className="fa-solid fa-xmark text-white/30 text-xs cursor-pointer hover:text-white/60"
                            onClick={() => {
                                setSearchTerm("");
                                setSelectedIndex(0);
                            }}
                        />
                    )}
                </div>
            </div>

            {/* Session list */}
            <div className="flex-1 overflow-y-auto">
                {error && (
                    <div className="px-4 py-3 text-red-400 text-xs">
                        <i className="fa-solid fa-triangle-exclamation mr-2" />
                        {error}
                    </div>
                )}

                {!error && filteredSessions.length === 0 && !loading && (
                    <div className="flex flex-col items-center justify-center h-full text-white/30">
                        <i className="fa-solid fa-messages text-3xl mb-3" />
                        <div className="text-sm">No Claude sessions found</div>
                        <div className="text-xs mt-1">Run Claude Code to see sessions here</div>
                    </div>
                )}

                {Array.from(grouped.entries()).map(([groupName, sessions]) => (
                    <div key={groupName}>
                        <div className="px-4 py-2 text-[11px] font-semibold text-white/40 uppercase tracking-wider bg-white/[0.02] sticky top-0 z-10">
                            {groupName}
                        </div>
                        {sessions.map((session) => {
                            const currentFlatIndex = flatIndex++;
                            return (
                                <SessionItem
                                    key={session.sessionid}
                                    session={session}
                                    isSelected={currentFlatIndex === selectedIndex}
                                    flatIndex={currentFlatIndex}
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
                        <i className="fa-solid fa-spinner fa-spin text-xl" />
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-white/10 text-[11px] text-white/30 flex items-center justify-between">
                <span>
                    {searchTerm
                        ? `${filteredSessions.length} matched`
                        : `${filteredSessions.length} sessions`}
                </span>
                <span>
                    <kbd className="px-1 py-0.5 bg-white/10 rounded text-[10px]">↑↓</kbd> Navigate{" "}
                    <kbd className="px-1 py-0.5 bg-white/10 rounded text-[10px]">↵</kbd> Open
                </span>
            </div>
        </div>
    );
}
