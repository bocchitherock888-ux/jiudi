//go:build windows

package main

import "os/exec"

func openDefaultBrowser(url string) {
	_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}
