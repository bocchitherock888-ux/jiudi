//go:build windows

package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/signal"
)

func notifyStop(stop chan<- os.Signal) {
	signal.Notify(stop, os.Interrupt)
}

func stopSignals(stop chan<- os.Signal) {
	signal.Stop(stop)
}

func printPlatformInstructions(stdout io.Writer) {
	fmt.Fprintln(stdout, "请保持此窗口打开。按 Enter 或 Ctrl+C 停止。")
}

func waitForPlatformEnter(stop chan<- os.Signal) {
	go func() {
		_, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err == nil {
			stop <- os.Interrupt
		}
	}()
}
