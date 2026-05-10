// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

var claudeWatcherOnce sync.Once

func StartClaudeWatcher() {
	claudeWatcherOnce.Do(func() {
		go func() {
			defer func() {
				panichandler.PanicHandler("StartClaudeWatcher", recover())
			}()
			startClaudeWatcherInternal()
		}()
	})
}

func startClaudeWatcherInternal() {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		log.Printf("claude watcher: cannot get home dir: %v\n", err)
		return
	}
	claudeDir := filepath.Join(homeDir, ".claude")
	if _, err := os.Stat(claudeDir); os.IsNotExist(err) {
		log.Printf("claude watcher: %s does not exist, not watching\n", claudeDir)
		return
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("claude watcher: failed to create watcher: %v\n", err)
		return
	}

	historyFile := filepath.Join(claudeDir, "history.jsonl")
	sessionsDir := filepath.Join(claudeDir, "sessions")

	if err := watcher.Add(claudeDir); err != nil {
		log.Printf("claude watcher: failed to watch %s: %v\n", claudeDir, err)
	}
	if _, err := os.Stat(sessionsDir); err == nil {
		if err := watcher.Add(sessionsDir); err != nil {
			log.Printf("claude watcher: failed to watch %s: %v\n", sessionsDir, err)
		}
	}

	log.Printf("claude watcher: started watching %s\n", claudeDir)

	// debounce: coalesce rapid changes into one event
	var debounceTimer *time.Timer
	var debounceMu sync.Mutex

	publishUpdate := func() {
		wps.Broker.Publish(wps.WaveEvent{
			Event: wps.Event_ClaudeSessions,
		})
	}

	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			if event.Op == fsnotify.Chmod {
				continue
			}
			base := filepath.Base(event.Name)
			isRelevant := base == "history.jsonl" ||
				filepath.Ext(base) == ".json" ||
				event.Name == historyFile

			if !isRelevant {
				continue
			}

			debounceMu.Lock()
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			debounceTimer = time.AfterFunc(500*time.Millisecond, publishUpdate)
			debounceMu.Unlock()

		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			log.Printf("claude watcher error: %v\n", err)
		}
	}
}
