//go:build !windows

package main

import (
	"io"
	"os"
	"os/signal"
	"syscall"
)

func notifyStop(stop chan<- os.Signal) {
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
}

func stopSignals(stop chan<- os.Signal) {
	signal.Stop(stop)
}

func printPlatformInstructions(io.Writer) {}

// Native macOS launches pass --no-browser and keep stdin closed. Shutdown is
// controlled exclusively by SIGTERM or interrupt on these builds.
func waitForPlatformEnter(chan<- os.Signal) {}
