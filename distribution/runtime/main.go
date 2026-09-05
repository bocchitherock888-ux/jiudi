package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"time"
)

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "就地："+err.Error())
		os.Exit(1)
	}
}

func run(args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("jiudi", flag.ContinueOnError)
	flags.SetOutput(stderr)
	noBrowser := flags.Bool("no-browser", false, "do not open a browser")
	selfTest := flags.Bool("self-test", false, "verify embedded assets and exit")
	verifyEncoder := flags.Bool("verify-encoder", false, "download and verify the encoder core, then exit")
	cacheDir := flags.String("cache-dir", "", "override the encoder cache directory")
	parentPID := flags.Int("parent-pid", 0, "exit when this parent process exits (macOS)")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %v", flags.Args())
	}

	assetFS, err := fs.Sub(embeddedAssets, "assets")
	if err != nil {
		return fmt.Errorf("embedded assets: %w", err)
	}
	if err := validateExactAssets(assetFS, embeddedAssetSpecs); err != nil {
		return fmt.Errorf("asset self-test failed: %w", err)
	}
	if *parentPID < 0 {
		return fmt.Errorf("parent-pid must be a positive integer")
	}
	if *selfTest && *verifyEncoder {
		return fmt.Errorf("self-test and verify-encoder cannot be combined")
	}
	var encoder *encoderManager
	if *cacheDir != "" {
		encoder = newEncoderManager(*cacheDir, encoderAssetSpecs, encoderURLs, fetchRemote)
	} else {
		encoder = newDefaultEncoderManager()
	}
	if *selfTest {
		if encoder.snapshot().ready {
			fmt.Fprintf(stdout, "self-test: ok (%d embedded assets; encoder core cache verified)\n", len(embeddedAssetSpecs))
		} else {
			fmt.Fprintf(stdout, "self-test: ok (%d embedded assets; encoder core available on demand)\n", len(embeddedAssetSpecs))
		}
		return nil
	}
	if *verifyEncoder {
		state := encoder.verify(context.Background())
		if !state.ready {
			return fmt.Errorf("encoder verification failed: %s", state.err)
		}
		fmt.Fprintln(stdout, "encoder: ok")
		return nil
	}

	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("start loopback server: %w", err)
	}
	defer listener.Close()
	host := listener.Addr().String()
	url := "http://" + host + "/"
	server := &http.Server{
		Handler:           &runtimeHandler{assets: assetFS, expectedHost: host, encoder: encoder},
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
	}

	serveDone := make(chan error, 1)
	go func() {
		err := server.Serve(listener)
		if err == http.ErrServerClosed {
			err = nil
		}
		serveDone <- err
	}()
	fmt.Fprintf(stdout, "就地  %s\n", url)
	if !*noBrowser {
		openDefaultBrowser(url)
	}
	printPlatformInstructions(stdout)

	stop := make(chan os.Signal, 1)
	notifyStop(stop)
	defer stopSignals(stop)
	waitForPlatformEnter(stop)
	monitorParent(*parentPID, stop)
	select {
	case err := <-serveDone:
		return err
	case <-stop:
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		return fmt.Errorf("stop server: %w", err)
	}
	return <-serveDone
}
