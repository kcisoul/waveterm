// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const ClosedKindTab = "tab"
const ClosedKindBlock = "block"

const closedRingMax = 20

type ctxSkipCloseSnapshotKey struct{}

type BlockSnap struct {
	OriginalId string              `json:"originalid"`
	Meta       waveobj.MetaMapType `json:"meta"`
	SubBlocks  []*BlockSnap        `json:"subblocks,omitempty"`
}

type TabSnap struct {
	Name        string              `json:"name"`
	LayoutState string              `json:"layoutstate"`
	Meta        waveobj.MetaMapType `json:"meta"`
	Blocks      []*BlockSnap        `json:"blocks"`
}

type ClosedItem struct {
	Kind        string     `json:"kind"`
	ClosedAt    int64      `json:"closedat"`
	WorkspaceId string     `json:"workspaceid,omitempty"`
	TabId       string     `json:"tabid,omitempty"`
	Tab         *TabSnap   `json:"tab,omitempty"`
	Block       *BlockSnap `json:"block,omitempty"`
}

var (
	closedRingMu sync.Mutex
	closedRing   []*ClosedItem
)

func ContextWithSkipCloseSnapshot(ctx context.Context) context.Context {
	return context.WithValue(ctx, ctxSkipCloseSnapshotKey{}, true)
}

func shouldSkipCloseSnapshot(ctx context.Context) bool {
	v, _ := ctx.Value(ctxSkipCloseSnapshotKey{}).(bool)
	return v
}

func PushClosedItem(item *ClosedItem) {
	closedRingMu.Lock()
	defer closedRingMu.Unlock()
	item.ClosedAt = time.Now().UnixMilli()
	closedRing = append(closedRing, item)
	if len(closedRing) > closedRingMax {
		closedRing = closedRing[len(closedRing)-closedRingMax:]
	}
}

func PopClosedItem() *ClosedItem {
	closedRingMu.Lock()
	defer closedRingMu.Unlock()
	if len(closedRing) == 0 {
		return nil
	}
	item := closedRing[len(closedRing)-1]
	closedRing = closedRing[:len(closedRing)-1]
	return item
}

func snapshotBlock(ctx context.Context, blockId string) (*BlockSnap, error) {
	block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
	if err != nil || block == nil {
		return nil, err
	}
	snap := &BlockSnap{
		OriginalId: block.OID,
		Meta:       cloneMeta(block.Meta),
	}
	for _, subId := range block.SubBlockIds {
		subSnap, err := snapshotBlock(ctx, subId)
		if err != nil || subSnap == nil {
			continue
		}
		snap.SubBlocks = append(snap.SubBlocks, subSnap)
	}
	return snap, nil
}

func snapshotTab(ctx context.Context, workspaceId, tabId string) *ClosedItem {
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil || tab == nil {
		return nil
	}
	tabSnap := &TabSnap{
		Name:        tab.Name,
		LayoutState: "",
		Meta:        cloneMeta(tab.Meta),
	}
	if layout, err := wstore.DBGet[*waveobj.LayoutState](ctx, tab.LayoutState); err == nil && layout != nil {
		if data, err := json.Marshal(layout); err == nil {
			tabSnap.LayoutState = string(data)
		}
	}
	for _, blockId := range tab.BlockIds {
		blockSnap, err := snapshotBlock(ctx, blockId)
		if err != nil || blockSnap == nil {
			continue
		}
		tabSnap.Blocks = append(tabSnap.Blocks, blockSnap)
	}
	return &ClosedItem{
		Kind:        ClosedKindTab,
		WorkspaceId: workspaceId,
		Tab:         tabSnap,
	}
}

func cloneMeta(m waveobj.MetaMapType) waveobj.MetaMapType {
	if m == nil {
		return nil
	}
	out := make(waveobj.MetaMapType, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}
