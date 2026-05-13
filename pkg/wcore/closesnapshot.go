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

const closedRingMaxPerTab = 20

type ctxSkipCloseSnapshotKey struct{}

type BlockSnap struct {
	OriginalId string              `json:"originalid"`
	Meta       waveobj.MetaMapType `json:"meta"`
	SubBlocks  []*BlockSnap        `json:"subblocks,omitempty"`
}

type BlockAnchor struct {
	SiblingBlockId string  `json:"siblingblockid"`
	Direction      string  `json:"direction"` // "horizontal" or "vertical"
	Position       string  `json:"position"`  // "before" or "after"
	Size           float64 `json:"size,omitempty"`
}

type ClosedItem struct {
	ClosedAt int64        `json:"closedat"`
	Block    *BlockSnap   `json:"block"`
	Anchor   *BlockAnchor `json:"anchor,omitempty"`
}

var (
	closedRingMu    sync.Mutex
	closedRingByTab = map[string][]*ClosedItem{}
)

func ContextWithSkipCloseSnapshot(ctx context.Context) context.Context {
	return context.WithValue(ctx, ctxSkipCloseSnapshotKey{}, true)
}

func shouldSkipCloseSnapshot(ctx context.Context) bool {
	v, _ := ctx.Value(ctxSkipCloseSnapshotKey{}).(bool)
	return v
}

func PushClosedBlock(tabId string, item *ClosedItem) {
	if tabId == "" || item == nil {
		return
	}
	closedRingMu.Lock()
	defer closedRingMu.Unlock()
	item.ClosedAt = time.Now().UnixMilli()
	ring := closedRingByTab[tabId]
	ring = append(ring, item)
	if len(ring) > closedRingMaxPerTab {
		ring = ring[len(ring)-closedRingMaxPerTab:]
	}
	closedRingByTab[tabId] = ring
}

func PopClosedBlock(tabId string) *ClosedItem {
	closedRingMu.Lock()
	defer closedRingMu.Unlock()
	ring := closedRingByTab[tabId]
	if len(ring) == 0 {
		return nil
	}
	item := ring[len(ring)-1]
	closedRingByTab[tabId] = ring[:len(ring)-1]
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

type layoutNodeForFind struct {
	FlexDirection string               `json:"flexDirection,omitempty"`
	Size          float64              `json:"size,omitempty"`
	Children      []*layoutNodeForFind `json:"children,omitempty"`
	Data          *layoutDataForFind   `json:"data,omitempty"`
}

type layoutDataForFind struct {
	BlockId string `json:"blockId,omitempty"`
}

// FindBlockAnchor walks the tab's layout tree and returns positioning info
// for blockId relative to an adjacent sibling, suitable for replaying as a
// Split action on restore. Returns nil if no usable anchor (e.g., root block).
func FindBlockAnchor(ctx context.Context, tabId, blockId string) *BlockAnchor {
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil || tab == nil {
		return nil
	}
	layout, err := wstore.DBGet[*waveobj.LayoutState](ctx, tab.LayoutState)
	if err != nil || layout == nil || layout.RootNode == nil {
		return nil
	}
	rawJSON, err := json.Marshal(layout.RootNode)
	if err != nil {
		return nil
	}
	var root layoutNodeForFind
	if err := json.Unmarshal(rawJSON, &root); err != nil {
		return nil
	}
	return findAnchorIn(&root, blockId)
}

func findAnchorIn(node *layoutNodeForFind, blockId string) *BlockAnchor {
	if node == nil {
		return nil
	}
	for idx, child := range node.Children {
		if child.Data != nil && child.Data.BlockId == blockId {
			var sibling *layoutNodeForFind
			pos := "after"
			if idx > 0 {
				sibling = node.Children[idx-1]
				pos = "after"
			} else if idx+1 < len(node.Children) {
				sibling = node.Children[idx+1]
				pos = "before"
			}
			if sibling == nil || sibling.Data == nil || sibling.Data.BlockId == "" {
				return nil
			}
			direction := "horizontal"
			if node.FlexDirection == "column" {
				direction = "vertical"
			}
			return &BlockAnchor{
				SiblingBlockId: sibling.Data.BlockId,
				Direction:      direction,
				Position:       pos,
				Size:           child.Size,
			}
		}
		if anchor := findAnchorIn(child, blockId); anchor != nil {
			return anchor
		}
	}
	return nil
}
