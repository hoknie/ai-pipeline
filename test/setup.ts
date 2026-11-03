import { inject } from 'vitest';

// Before any test file is imported: test files call `tmpdir()` at the top level too.
process.env.TMPDIR = inject('temporaryDirectory');
process.env.NODE_COMPILE_CACHE = inject('compileCache');
