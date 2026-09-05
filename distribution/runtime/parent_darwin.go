//go:build darwin

package main

import (
	"os"
	"syscall"
	"time"
)

func monitorParent(pid int, stop chan<- os.Signal) {
	if pid == 0 {
		return
	}
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for range ticker.C {
			err := syscall.Kill(pid, 0)
			if err == nil || err == syscall.EPERM {
				continue
			}
			stop <- syscall.SIGTERM
			return
		}
	}()
}
