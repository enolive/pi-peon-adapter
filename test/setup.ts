// Global test setup: disable debug logging for all tests unless stated differently inside the test
//
// Why? You have PI_PEON_ADAPTER_DEBUG_LOG set in your shell to debug the adapter.
// You run `npm test` inside pi. Tests spawn subprocesses that also use the adapter.
// Those tests write to YOUR debug log, polluting it with test garbage.
// Now you need debug logging to debug why your debug log is garbage.
// This is called "debug inception" - a crime punishable by losing 3 hours of your life.
//
// Solution: Kill the env var in test process so tests don't write to production log.
delete process.env.PI_PEON_ADAPTER_DEBUG_LOG
