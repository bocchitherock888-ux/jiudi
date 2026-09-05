//go:build darwin

package main

import "os/exec"

func openDefaultBrowser(url string) {
	_ = exec.Command("open", url).Start()
}
