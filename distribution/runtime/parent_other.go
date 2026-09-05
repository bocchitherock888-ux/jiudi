//go:build !darwin

package main

import "os"

func monitorParent(int, chan<- os.Signal) {}
