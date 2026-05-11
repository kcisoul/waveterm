// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    getBlockComponentModel,
    getAllBlockComponentModels,
    globalStore,
    WOS,
    createBlock,
} from "@/store/global";
import { TermViewModel } from "@/app/view/term/term-model";
import * as jotai from "jotai";
import { ExplorerView } from "./explorer";

type TreeNodeState = {
    expanded: boolean;
    children: FileInfo[] | null;
    loading: boolean;
};

type BlockExplorerState = {
    rootPath: string;
    expandedDirs: Map<string, TreeNodeState>;
    scrollTop: number;
};

export class ExplorerViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    viewIcon = jotai.atom<string | IconButtonDecl>("folder-tree");
    viewName = jotai.atom("Explorer");
    viewComponent = ExplorerView;
    noPadding = jotai.atom(true);

    rootPathAtom: jotai.PrimitiveAtom<string>;
    treeDataAtom: jotai.PrimitiveAtom<Map<string, TreeNodeState>>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;
    errorAtom: jotai.PrimitiveAtom<string>;
    trackedBlockIdAtom: jotai.PrimitiveAtom<string>;
    noClaudeAtom: jotai.PrimitiveAtom<boolean>;
    viewText: jotai.Atom<HeaderElem[]>;

    private blockStateCache: Map<string, BlockExplorerState> = new Map();
    private blockClickUnsubFn: () => void;

    constructor({ blockId, nodeModel }: ViewModelInitType) {
        this.viewType = "explorer";
        this.blockId = blockId;
        this.nodeModel = nodeModel;

        this.rootPathAtom = jotai.atom("") as jotai.PrimitiveAtom<string>;
        this.treeDataAtom = jotai.atom(new Map<string, TreeNodeState>()) as jotai.PrimitiveAtom<Map<string, TreeNodeState>>;
        this.loadingAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
        this.errorAtom = jotai.atom("") as jotai.PrimitiveAtom<string>;
        this.trackedBlockIdAtom = jotai.atom("") as jotai.PrimitiveAtom<string>;
        this.noClaudeAtom = jotai.atom(true) as jotai.PrimitiveAtom<boolean>;

        this.viewText = jotai.atom((get) => {
            const rootPath = get(this.rootPathAtom);
            const loading = get(this.loadingAtom);
            const rtn: HeaderElem[] = [];
            rtn.push({
                elemtype: "iconbutton",
                icon: loading ? "spinner" : "rotate-right",
                title: "Refresh",
                iconSpin: loading,
                click: () => this.refreshCurrentDir(),
            });
            if (rootPath) {
                const shortPath = this.shortenPath(rootPath);
                rtn.push({
                    elemtype: "text",
                    text: shortPath,
                    noGrow: true,
                });
            }
            return rtn;
        });

        this.blockClickUnsubFn = waveEventSubscribeSingle({
            eventType: "block:click",
            handler: (event) => {
                const clickedBlockId = event.data as string;
                if (clickedBlockId && clickedBlockId !== this.blockId) {
                    this.handleBlockFocus(clickedBlockId);
                }
            },
        });

        this.scanForClaudeBlock();
    }

    private shortenPath(path: string): string {
        const home = "~";
        const parts = path.split("/");
        if (parts.length <= 3) return path.replace(/^\/Users\/[^/]+/, home);
        const last2 = parts.slice(-2).join("/");
        return ".../" + last2;
    }

    private scanForClaudeBlock() {
        const allModels = getAllBlockComponentModels();
        for (const bcm of allModels) {
            const vm = bcm.viewModel;
            if (!(vm instanceof TermViewModel)) continue;
            const termRef = vm.termRef?.current;
            if (!termRef) continue;
            const isClaudeActive = globalStore.get(termRef.claudeCodeActiveAtom);
            if (isClaudeActive) {
                this.handleBlockFocus(vm.blockId);
                return;
            }
        }
        globalStore.set(this.noClaudeAtom, true);
    }

    private handleBlockFocus(blockId: string) {
        const bcm = getBlockComponentModel(blockId);
        if (!bcm) return;
        const vm = bcm.viewModel;
        if (!(vm instanceof TermViewModel)) return;

        const blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        const blockData = globalStore.get(blockAtom);
        const cwd = blockData?.meta?.["cmd:cwd"];
        if (!cwd) return;

        const currentTrackedId = globalStore.get(this.trackedBlockIdAtom);
        if (currentTrackedId === blockId) {
            return;
        }

        if (currentTrackedId) {
            this.saveBlockState(currentTrackedId);
        }

        globalStore.set(this.trackedBlockIdAtom, blockId);
        globalStore.set(this.noClaudeAtom, false);

        const cached = this.blockStateCache.get(blockId);
        if (cached && cached.rootPath === cwd) {
            this.restoreBlockState(cached);
        } else {
            this.setRootPath(cwd);
        }
    }

    private saveBlockState(blockId: string) {
        const rootPath = globalStore.get(this.rootPathAtom);
        const treeData = globalStore.get(this.treeDataAtom);
        if (!rootPath) return;
        this.blockStateCache.set(blockId, {
            rootPath,
            expandedDirs: new Map(treeData),
            scrollTop: 0,
        });
    }

    private restoreBlockState(state: BlockExplorerState) {
        globalStore.set(this.rootPathAtom, state.rootPath);
        globalStore.set(this.treeDataAtom, new Map(state.expandedDirs));
    }

    async setRootPath(path: string) {
        globalStore.set(this.rootPathAtom, path);
        globalStore.set(this.treeDataAtom, new Map());
        globalStore.set(this.errorAtom, "");
        await this.loadDirectory(path);
    }

    async loadDirectory(dirPath: string): Promise<FileInfo[]> {
        const treeData = new Map(globalStore.get(this.treeDataAtom));
        treeData.set(dirPath, {
            expanded: true,
            children: null,
            loading: true,
        });
        globalStore.set(this.treeDataAtom, treeData);

        try {
            globalStore.set(this.loadingAtom, true);
            const files = await RpcApi.FileListCommand(TabRpcClient, {
                path: dirPath,
                opts: { all: false },
            }, { timeout: 5000 });

            const sorted = this.sortFiles(files ?? []);

            const updatedTree = new Map(globalStore.get(this.treeDataAtom));
            updatedTree.set(dirPath, {
                expanded: true,
                children: sorted,
                loading: false,
            });
            globalStore.set(this.treeDataAtom, updatedTree);
            globalStore.set(this.errorAtom, "");
            return sorted;
        } catch (e) {
            const updatedTree = new Map(globalStore.get(this.treeDataAtom));
            updatedTree.set(dirPath, {
                expanded: false,
                children: null,
                loading: false,
            });
            globalStore.set(this.treeDataAtom, updatedTree);
            globalStore.set(this.errorAtom, String(e));
            return [];
        } finally {
            globalStore.set(this.loadingAtom, false);
        }
    }

    private sortFiles(files: FileInfo[]): FileInfo[] {
        return [...files].sort((a, b) => {
            if (a.isdir && !b.isdir) return -1;
            if (!a.isdir && b.isdir) return 1;
            const nameA = (a.name || a.path).toLowerCase();
            const nameB = (b.name || b.path).toLowerCase();
            return nameA.localeCompare(nameB);
        });
    }

    async toggleDirectory(dirPath: string) {
        const treeData = globalStore.get(this.treeDataAtom);
        const node = treeData.get(dirPath);
        if (!node) {
            await this.loadDirectory(dirPath);
            return;
        }
        if (node.expanded) {
            const updatedTree = new Map(treeData);
            updatedTree.set(dirPath, { ...node, expanded: false });
            globalStore.set(this.treeDataAtom, updatedTree);
        } else {
            if (node.children) {
                const updatedTree = new Map(treeData);
                updatedTree.set(dirPath, { ...node, expanded: true });
                globalStore.set(this.treeDataAtom, updatedTree);
            } else {
                await this.loadDirectory(dirPath);
            }
        }
    }

    async refreshCurrentDir() {
        const rootPath = globalStore.get(this.rootPathAtom);
        if (!rootPath) return;

        const treeData = globalStore.get(this.treeDataAtom);
        const expandedPaths: string[] = [];
        for (const [path, node] of treeData) {
            if (node.expanded) {
                expandedPaths.push(path);
            }
        }

        globalStore.set(this.treeDataAtom, new Map());

        for (const path of expandedPaths) {
            await this.loadDirectory(path);
        }
    }

    async openFile(filePath: string) {
        await createBlock({
            meta: {
                view: "preview",
                file: filePath,
            },
        });
    }

    getFilePath(file: FileInfo): string {
        if (file.dir) {
            return file.dir + "/" + (file.name || "");
        }
        return file.path;
    }

    giveFocus(): boolean {
        return true;
    }

    dispose() {
        if (this.blockClickUnsubFn) {
            this.blockClickUnsubFn();
        }
    }
}

export type { TreeNodeState };
