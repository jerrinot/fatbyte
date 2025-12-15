# Implementation Plan: JAR Bytecode Method Size Analyzer

This plan follows iterative development with testing after each iteration. No shortcuts or workarounds — issues must be fixed properly before proceeding.

---

## Iteration 1: Project Setup & Test Infrastructure

### 1.1 Initialize Project Structure

**Tasks:**
- Create directory structure:
  ```
  src/
  test/
    fixtures/
      java/
      classes/
  ```
- Initialize `package.json` with Vitest and JSZip as dev dependencies
- Create basic Vitest configuration

**Test Criteria:**
- `npm install` completes without errors
- `npm test` runs (even if no tests exist yet)

---

### 1.2 Create Java Test Fixtures (Source Files)

**Tasks:**
- Create `test/fixtures/java/SimpleClass.java` — baseline with constructor, getter, setter
- Create `test/fixtures/java/WithLongDouble.java` — tests double-slot constant pool entries (CONSTANT_Long, CONSTANT_Double)
- Create `test/fixtures/java/WithInterfaces.java` — tests interface table parsing
- Create `test/fixtures/java/AbstractMethods.java` — tests methods without Code attribute
- Create `test/fixtures/java/LambdasAndIndy.java` — tests CONSTANT_InvokeDynamic, MethodHandle, MethodType
- Create `test/fixtures/java/BigMethods.java` — tests large bytecode sizes
- Create `test/fixtures/java/NestedClasses.java` — tests inner/nested class naming
- Create `test/fixtures/java/AllPrimitiveTypes.java` — tests various descriptor formats

**Test Criteria:**
- All Java files compile successfully with `javac`

---

### 1.3 Create Fixture Generation Script

**Tasks:**
- Create `test/generate-fixtures.sh` script that:
  - Cleans `test/fixtures/classes/`
  - Compiles all Java files to `test/fixtures/classes/`
  - Generates `test/fixtures/expected.json` by parsing `javap -v` output
- Create `test/extract-expected.js` Node script for reliable expected value extraction

**Test Criteria:**
- Running `./test/generate-fixtures.sh` produces `.class` files
- `expected.json` contains method names and bytecode sizes for each class
- Bytecode sizes in `expected.json` match `javap -v` output when manually verified

---

## Iteration 2: Core Parser — Magic Number & Version

### 2.1 Implement Class File Header Parsing

**Tasks:**
- Create `src/parser.js` with `parseClassFile(arrayBuffer)` function
- Implement magic number verification (`0xCAFEBABE`)
- Parse minor/major version numbers
- Use `DataView` with big-endian byte order

**Test Criteria:**
- Valid class file returns version info without error
- Non-class file (garbage bytes) throws error mentioning "magic"
- Truncated file (< 10 bytes) throws appropriate error

**Tests to Write:**
```javascript
describe('Magic number validation', () => {
  it('accepts valid class file')
  it('rejects garbage data')
  it('rejects truncated data')
})
```

---

## Iteration 3: Constant Pool Parser

### 3.1 Parse Basic Constant Pool Entry Types

**Tasks:**
- Implement constant pool count reading
- Parse and store CONSTANT_Utf8 entries (tag 1)
- Skip CONSTANT_Integer (tag 3) — 4 bytes
- Skip CONSTANT_Float (tag 4) — 4 bytes
- Skip CONSTANT_Long (tag 5) — 8 bytes, mark next slot as empty
- Skip CONSTANT_Double (tag 6) — 8 bytes, mark next slot as empty
- Parse CONSTANT_Class (tag 7) — store name index
- Skip CONSTANT_String (tag 8) — 2 bytes
- Skip CONSTANT_Fieldref (tag 9) — 4 bytes
- Skip CONSTANT_Methodref (tag 10) — 4 bytes
- Skip CONSTANT_InterfaceMethodref (tag 11) — 4 bytes
- Parse CONSTANT_NameAndType (tag 12) — store name and descriptor indices

**Test Criteria:**
- `SimpleClass.class` parses without error
- `WithLongDouble.class` parses without error (validates Long/Double slot handling)
- Constant pool entries are accessible by index

**Tests to Write:**
```javascript
describe('Constant pool parsing - basic types', () => {
  it('parses SimpleClass constant pool')
  it('handles Long/Double double-slot entries in WithLongDouble')
})
```

---

### 3.2 Parse Modern Constant Pool Entry Types

**Tasks:**
- Skip CONSTANT_MethodHandle (tag 15) — 3 bytes
- Skip CONSTANT_MethodType (tag 16) — 2 bytes
- Skip CONSTANT_Dynamic (tag 17) — 4 bytes
- Skip CONSTANT_InvokeDynamic (tag 18) — 4 bytes
- Skip CONSTANT_Module (tag 19) — 2 bytes
- Skip CONSTANT_Package (tag 20) — 2 bytes
- Throw descriptive error for unknown tag types

**Test Criteria:**
- `LambdasAndIndy.class` parses without error (validates InvokeDynamic handling)
- Unknown tag type produces clear error message

**Tests to Write:**
```javascript
describe('Constant pool parsing - modern types', () => {
  it('parses LambdasAndIndy constant pool with InvokeDynamic entries')
  it('throws on unknown constant pool tag')
})
```

---

## Iteration 4: Class Structure Navigation

### 4.1 Parse Class Header (Post-Constant Pool)

**Tasks:**
- Skip access_flags (2 bytes)
- Read this_class index, resolve class name from constant pool
- Skip super_class (2 bytes)
- Read interfaces_count, skip interfaces (count * 2 bytes)

**Test Criteria:**
- `SimpleClass` reports class name as `fixtures/SimpleClass`
- `WithInterfaces` parses correctly despite having multiple interfaces

**Tests to Write:**
```javascript
describe('Class header parsing', () => {
  it('extracts class name from SimpleClass')
  it('correctly skips interface table in WithInterfaces')
})
```

---

### 4.2 Skip Fields Section

**Tasks:**
- Read fields_count
- For each field:
  - Read access_flags (2), name_index (2), descriptor_index (2)
  - Read attributes_count
  - For each attribute: read attribute_name_index (2), attribute_length (4), skip attribute_length bytes

**Test Criteria:**
- Classes with fields parse without error
- Position after fields section is correct (validated by successful method parsing)

**Tests to Write:**
```javascript
describe('Fields section skipping', () => {
  it('skips fields in SimpleClass (has private field)')
  it('skips fields and continues to methods correctly')
})
```

---

## Iteration 5: Method Parsing

### 5.1 Parse Method Headers

**Tasks:**
- Read methods_count
- For each method:
  - Read access_flags, name_index, descriptor_index
  - Resolve method name and descriptor from constant pool
  - Initialize bytecodeSize to 0

**Test Criteria:**
- `SimpleClass` reports correct method names: `<init>`, `getValue`, `setValue`
- Method descriptors are correctly resolved

**Tests to Write:**
```javascript
describe('Method header parsing', () => {
  it('finds all methods in SimpleClass')
  it('resolves method names correctly')
  it('resolves method descriptors correctly')
})
```

---

### 5.2 Parse Method Attributes & Extract Code Size

**Tasks:**
- Read attributes_count for each method
- For each attribute:
  - Read attribute_name_index, resolve to string
  - Read attribute_length
  - If attribute name is "Code":
    - Skip max_stack (2), max_locals (2)
    - Read code_length (4 bytes, u4) — this is the bytecode size
  - Skip remaining attribute bytes

**Test Criteria:**
- `SimpleClass` method bytecode sizes match `expected.json`
- `AbstractMethods` reports 0 bytecode size for abstract/native methods
- `BigMethods.bigMethod` has larger bytecode than `smallMethod`

**Tests to Write:**
```javascript
describe('Code attribute extraction', () => {
  it('extracts correct bytecode sizes from SimpleClass')
  it('reports 0 for abstract methods')
  it('reports 0 for native methods')
  it('extracts correct size for bigMethod')
})
```

---

## Iteration 6: Full Parser Validation

### 6.1 Validate Against All Test Fixtures

**Tasks:**
- Run parser against all fixture classes
- Compare every method's bytecode size against `expected.json`
- Fix any discrepancies found

**Test Criteria:**
- All fixture classes parse without error
- All bytecode sizes match expected values exactly

**Tests to Write:**
```javascript
describe('Full parser validation', () => {
  for (const className of Object.keys(EXPECTED)) {
    it(`matches expected values for ${className}`)
  }
})
```

---

### 6.2 Validate Nested Classes

**Tasks:**
- Ensure parser handles `$` in class names correctly
- Test `NestedClasses$Inner.class`, `NestedClasses$StaticNested.class`
- Test anonymous inner classes if generated

**Test Criteria:**
- Inner class names are correctly reported
- All nested class methods have correct bytecode sizes

**Tests to Write:**
```javascript
describe('Nested class handling', () => {
  it('parses inner class NestedClasses$Inner')
  it('parses static nested class NestedClasses$StaticNested')
  it('handles anonymous inner classes')
})
```

---

## Iteration 7: JAR Extraction Integration

### 7.1 Implement JAR Parsing with JSZip

**Tasks:**
- Create `parseJar(arrayBuffer)` async function
- Use JSZip to extract ZIP contents
- Filter for `.class` files only
- Parse each class file, aggregate results
- Handle malformed class files gracefully (log warning, continue)

**Test Criteria:**
- Can create in-memory JAR from fixtures and parse it
- Malformed class file in JAR doesn't crash entire process
- Non-class files in JAR are ignored

**Tests to Write:**
```javascript
describe('JAR parsing', () => {
  it('extracts and parses all class files from JAR')
  it('ignores non-class files')
  it('continues after encountering malformed class')
})
```

---

### 7.2 Implement Results Aggregation & Sorting

**Tasks:**
- Flatten all methods from all classes into single array
- Add fully-qualified class name (dot notation) to each method
- Sort by bytecodeSize descending
- Return top N results (default 10)

**Test Criteria:**
- Results are sorted largest-first
- Each result contains: className, methodName, descriptor, bytecodeSize
- Class names use dot notation (e.g., `fixtures.SimpleClass`)

**Tests to Write:**
```javascript
describe('Results aggregation', () => {
  it('returns methods sorted by size descending')
  it('converts class names to dot notation')
  it('respects top N limit')
})
```

---

## Iteration 8: User Interface — Core Structure

### 8.1 Create HTML Structure

**Tasks:**
- Create `index.html` with semantic structure
- Add drop zone container
- Add results table container
- Add summary stats container
- Add error display container
- Style with inline CSS (minimal, functional)

**Test Criteria:**
- Page loads without JavaScript errors
- All containers are present and visible
- Layout matches design mockup

**Manual Test:**
- Open `index.html` in browser
- Verify layout structure

---

### 8.2 Implement File Drop Zone

**Tasks:**
- Add drag-and-drop event handlers (dragover, dragleave, drop)
- Add click-to-browse via hidden file input
- Style drop zone with visual feedback on drag
- Accept only `.jar` files

**Test Criteria:**
- Dragging file over drop zone shows visual feedback
- Dropping non-JAR file shows error
- Click opens file browser filtered to JAR files

**Manual Test:**
- Drag file over drop zone — verify highlight
- Drop non-JAR file — verify error message
- Click and select JAR file — verify acceptance

---

## Iteration 9: User Interface — Results Display

### 9.1 Implement Results Table

**Tasks:**
- Create table with columns: Rank, Class, Method, Descriptor, Size (bytes)
- Populate table from parsed results
- Format class names (abbreviate packages if needed)
- Format descriptor (truncate long ones with tooltip)
- Format size with thousand separators

**Test Criteria:**
- Table displays correct data
- Rank numbers are sequential
- Size values are formatted (e.g., "12,847")

**Manual Test:**
- Parse a real JAR file
- Verify table contents match expected largest methods

---

### 9.2 Implement Summary Stats

**Tasks:**
- Display total classes scanned
- Display total methods found
- Display parsing time

**Test Criteria:**
- Stats update after each JAR parse
- Counts are accurate
- Time is displayed in reasonable units (ms or s)

---

### 9.3 Implement Progress Indicator

**Tasks:**
- Show progress during large JAR parsing
- Update progress as each class file is processed
- Hide progress when complete

**Test Criteria:**
- Progress shows during parsing
- Progress updates incrementally
- Progress disappears after completion

---

## Iteration 10: Error Handling & Edge Cases

### 10.1 Implement Error Display

**Tasks:**
- Show clear error for invalid JAR (not a ZIP)
- Show warning list for malformed class files
- Show message when no `.class` files found
- Handle empty JAR gracefully

**Test Criteria:**
- Invalid ZIP shows "Invalid JAR file" error
- Malformed class files are listed as warnings
- Empty JAR shows "No class files found" message

**Tests to Write:**
```javascript
describe('Error handling', () => {
  it('reports invalid JAR format')
  it('lists malformed class files as warnings')
  it('handles empty JAR')
  it('handles JAR with no class files')
})
```

---

### 10.2 Handle Edge Cases

**Tasks:**
- Support multi-release JARs (META-INF/versions/)
- Handle very large JARs (thousands of classes)
- Handle class files with no methods

**Test Criteria:**
- Multi-release JAR parses classes from all versions
- Large JAR doesn't freeze browser (use async processing)
- Classes with no methods don't cause errors

---

## Iteration 11: Final Integration & Bundling

### 11.1 Bundle into Single HTML File

**Tasks:**
- Create build script that:
  - Inlines all JavaScript into `index.html`
  - Inlines all CSS into `index.html`
  - Keeps JSZip loaded from CDN
- Verify bundled file works standalone

**Test Criteria:**
- Single `index.html` file works without any other files
- All functionality works in bundled version
- File size is reasonable (< 50KB excluding JSZip from CDN)

---

### 11.2 Cross-Browser Testing

**Tasks:**
- Test in Chrome/Edge
- Test in Firefox
- Test in Safari

**Test Criteria:**
- All functionality works in all major browsers
- No console errors in any browser

---

### 11.3 Final Validation

**Tasks:**
- Test with real-world JARs:
  - Spring Boot application JAR
  - Maven dependency JAR
  - Empty/minimal JAR
- Verify results against `javap -v` for spot-checked methods

**Test Criteria:**
- Real JAR files parse correctly
- Top 10 methods list makes sense
- Bytecode sizes are accurate

---

## Definition of Done

Each iteration is complete when:
1. All tasks in the iteration are implemented
2. All specified tests pass
3. No regressions in previously passing tests
4. Code is clean and readable (no TODO comments left behind)
5. Any bugs found are fixed properly, not worked around

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Constant pool parsing incorrect | Test with fixtures containing all constant types |
| Long/Double slot handling wrong | WithLongDouble fixture specifically tests this |
| Field/method attribute parsing offset | Validate against javap output for every fixture |
| Browser compatibility issues | Test in all major browsers each iteration |
| Large JAR performance | Use async processing, test with large real JARs |

---

## Iteration Summary

| # | Focus | Key Deliverable |
|---|-------|-----------------|
| 1 | Setup | Project structure, test fixtures |
| 2 | Parser: Header | Magic number validation |
| 3 | Parser: Constant Pool | All 20 constant types handled |
| 4 | Parser: Class Structure | Class name extraction, skip interfaces/fields |
| 5 | Parser: Methods | Method names, descriptors, bytecode sizes |
| 6 | Parser: Validation | 100% match against expected.json |
| 7 | JAR Integration | JSZip extraction, result aggregation |
| 8 | UI: Structure | HTML/CSS, drop zone |
| 9 | UI: Results | Table, stats, progress |
| 10 | Error Handling | Graceful failures, edge cases |
| 11 | Final | Bundle, cross-browser, real-world validation |
