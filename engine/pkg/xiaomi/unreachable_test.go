package xiaomi_test

import (
	"errors"
	"github.com/AlexxIT/go2rtc/pkg/tutk"
	"github.com/AlexxIT/go2rtc/pkg/xiaomi/miss/cs2"
	"net"
	"testing"
	"time"
)

// Exercise actual handshake deadlines with a bound but silent local device.
// No real camera or Xiaomi cloud service is contacted by this test.
func TestUnresponsiveLocalDevice(t *testing.T) {
	for _, protocol := range []string{"cs2", "tutk"} {
		t.Run(protocol, func(t *testing.T) {
			t.Parallel()
			device, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
			if err != nil {
				t.Fatal(err)
			}
			defer device.Close()
			start := time.Now()
			if protocol == "cs2" {
				c, e := cs2.Dial(device.LocalAddr().String(), "udp")
				err = e
				if c != nil {
					c.Close()
					t.Fatal("unexpected connection to silent device")
				}
			} else {
				c, e := tutk.Dial(device.LocalAddr().String(), "00000000000000000000", "Miss", "client")
				err = e
				if c != nil {
					c.Close()
					t.Fatal("unexpected connection to silent device")
				}
			}
			var networkError net.Error
			if !errors.As(err, &networkError) || !networkError.Timeout() {
				t.Fatalf("expected network timeout, got %v", err)
			}
			if elapsed := time.Since(start); elapsed < 4*time.Second || elapsed > 8*time.Second {
				t.Fatalf("unexpected handshake duration: %v", elapsed)
			}
			t.Logf("%s unreachable-device handshake returned timeout in %s", protocol, time.Since(start))
		})
	}
}
