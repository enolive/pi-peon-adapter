// Global test setup: disable debug logging for all tests unless stated differently inside the test
// if the process running the tests activates this environment variable,
// the tests will also write to it polluting it with garbage and also causing confusion.
delete process.env.PI_PEON_ADAPTER_DEBUG_LOG
