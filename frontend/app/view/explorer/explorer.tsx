// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { ViewComponentProps } from "@/app/block/blocktypes";
import ClaudeColorSvg from "@/app/asset/claude-color.svg";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { getApi } from "@/store/global";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import * as React from "react";
import type { ExplorerViewModel, TreeNodeState } from "./explorer-model";
import "./explorer.scss";

function getFileIcon(file: FileInfo): string {
    if (file.isdir) return "folder";
    const name = (file.name || file.path || "").toLowerCase();
    const ext = name.split(".").pop();
    switch (ext) {
        case "ts":
        case "tsx":
            return "file-code";
        case "js":
        case "jsx":
            return "file-code";
        case "go":
            return "file-code";
        case "py":
            return "file-code";
        case "rs":
            return "file-code";
        case "json":
            return "file-lines";
        case "yaml":
        case "yml":
            return "file-lines";
        case "toml":
            return "file-lines";
        case "md":
            return "file-lines";
        case "css":
        case "scss":
        case "less":
            return "file-code";
        case "html":
            return "file-code";
        case "svg":
        case "png":
        case "jpg":
        case "jpeg":
        case "gif":
        case "ico":
            return "file-image";
        case "sh":
        case "bash":
        case "zsh":
            return "file-code";
        case "lock":
            return "file-shield";
        default:
            return "file";
    }
}

function getFileIconColor(file: FileInfo): string {
    if (file.isdir) return "#e8a838";
    const name = (file.name || file.path || "").toLowerCase();
    const ext = name.split(".").pop();
    switch (ext) {
        case "ts":
        case "tsx":
            return "#3178c6";
        case "js":
        case "jsx":
            return "#f7df1e";
        case "go":
            return "#00add8";
        case "py":
            return "#3776ab";
        case "rs":
            return "#dea584";
        case "json":
            return "#a8b1c2";
        case "md":
            return "#519aba";
        case "css":
        case "scss":
            return "#563d7c";
        case "html":
            return "#e34c26";
        case "svg":
        case "png":
        case "jpg":
            return "#a074c4";
        default:
            return "#a8b1c2";
    }
}

const TreeItem = React.memo(function TreeItem({
    file,
    depth,
    model,
    treeData,
}: {
    file: FileInfo;
    depth: number;
    model: ExplorerViewModel;
    treeData: Map<string, TreeNodeState>;
}) {
    const filePath = model.getFilePath(file);
    const isDir = file.isdir;
    const node = treeData.get(filePath);
    const isExpanded = node?.expanded ?? false;
    const isLoading = node?.loading ?? false;
    const children = node?.children;

    const handleClick = (e: React.MouseEvent) => {
        if (e.metaKey || e.ctrlKey) {
            getApi().openNativePath(filePath);
            return;
        }
        if (isDir) {
            model.toggleDirectory(filePath);
        } else {
            model.openFile(filePath);
        }
    };

    const handleDragStart = (e: React.DragEvent) => {
        e.dataTransfer.setData("text/plain", filePath);
        e.dataTransfer.effectAllowed = "copy";
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        const menuItems: ContextMenuItem[] = [];
        if (isDir) {
            menuItems.push({
                label: "Open in Wave",
                click: () => model.openFile(filePath),
            });
        } else {
            menuItems.push({
                label: "Open in Wave",
                click: () => model.openFile(filePath),
            });
        }
        menuItems.push({
            label: "Open with Default App",
            click: () => getApi().openNativePath(filePath),
        });
        menuItems.push({ type: "separator" });
        menuItems.push({
            label: "Copy Path",
            click: () => navigator.clipboard.writeText(filePath),
        });
        ContextMenuModel.getInstance().showContextMenu(menuItems, e);
    };

    const fileName = file.name || filePath.split("/").pop() || "";
    const icon = getFileIcon(file);
    const iconColor = getFileIconColor(file);

    return (
        <>
            <div
                className="explorer-tree-item cursor-pointer"
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
                draggable
                onDragStart={handleDragStart}
            >
                {isDir && (
                    <i
                        className={clsx(
                            "fa-solid explorer-tree-chevron",
                            isLoading ? "fa-spinner fa-spin" : isExpanded ? "fa-chevron-down" : "fa-chevron-right"
                        )}
                    />
                )}
                {!isDir && <span className="explorer-tree-chevron-spacer" />}
                <i
                    className={clsx("fa-solid", `fa-${icon}`, "explorer-tree-icon")}
                    style={{ color: iconColor }}
                />
                <span className="explorer-tree-name">{fileName}</span>
            </div>
            {isDir && isExpanded && children && (
                children.map((child) => {
                    const childPath = model.getFilePath(child);
                    return (
                        <TreeItem
                            key={childPath}
                            file={child}
                            depth={depth + 1}
                            model={model}
                            treeData={treeData}
                        />
                    );
                })
            )}
        </>
    );
});
TreeItem.displayName = "TreeItem";

export function ExplorerView({ blockId, model }: ViewComponentProps<ExplorerViewModel>) {
    const rootPath = useAtomValue(model.rootPathAtom);
    const treeData = useAtomValue(model.treeDataAtom);
    const loading = useAtomValue(model.loadingAtom);
    const error = useAtomValue(model.errorAtom);
    const noClaude = useAtomValue(model.noClaudeAtom);

    const rootNode = treeData.get(rootPath);
    const rootChildren = rootNode?.children;

    if (noClaude && !rootPath) {
        return (
            <div className="explorer-container">
                <div className="explorer-empty">
                    <div className="explorer-empty-icon">
                        <ClaudeColorSvg />
                    </div>
                    <div className="explorer-empty-title">No Claude Session</div>
                    <div className="explorer-empty-subtitle">
                        Focus a terminal running Claude Code to explore its project files
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="explorer-container">
            {rootPath && (
                <div className="explorer-breadcrumb">
                    <i className="fa-solid fa-folder-open explorer-breadcrumb-icon" />
                    <span className="explorer-breadcrumb-path">{rootPath}</span>
                </div>
            )}
            <div className="explorer-tree">
                {error && (
                    <div className="explorer-error">
                        <i className="fa-solid fa-triangle-exclamation" />
                        <span>{error}</span>
                    </div>
                )}
                {!error && rootChildren && rootChildren.length === 0 && (
                    <div className="explorer-empty-dir">
                        <i className="fa-solid fa-folder-open" />
                        <span>Empty directory</span>
                    </div>
                )}
                {rootChildren && rootChildren.map((file) => {
                    const filePath = model.getFilePath(file);
                    return (
                        <TreeItem
                            key={filePath}
                            file={file}
                            depth={0}
                            model={model}
                            treeData={treeData}
                        />
                    );
                })}
                {loading && !rootChildren && (
                    <div className="explorer-loading">
                        <i className="fa-solid fa-spinner fa-spin" />
                    </div>
                )}
            </div>
        </div>
    );
}
