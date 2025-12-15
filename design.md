# Design Document: JAR Bytecode Method Size Analyzer

## Overview

A single-page static web application that allows users to upload a Java JAR file and displays the top 10 largest methods ranked by bytecode size (in bytes). Runs entirely client-side with no server component.

## Goals

- Zero dependencies on server-side processing
- Single HTML file (inline CSS/JS) for easy distribution
- Support for standard JAR files (including multi-release JARs)
- Clear, sortable results showing class name, method name, descriptor, and bytecode size
- Comprehensive test coverage with javac-generated test fixtures

## Technical Approach

### Architecture

```
User drops JAR file
        ↓
    JSZip extracts .class files from ZIP
        ↓
    For each .class file:
        → Parse class file binary format
        → Extract all methods with their Code attributes
        → Record: (className, methodName, descriptor, codeLength)
        ↓
    Sort all methods by codeLength descending
        ↓
    Display top 10 in results table
```

### Dependencies

- **JSZip 3.x** (loaded from cdnjs) — for extracting `.class` files from the JAR

### Class File Parser Implementation

Implement a JavaScript class file parser that handles the following:

#### Constant Pool Parsing

Must handle these constant pool entry types to correctly navigate the pool and resolve names:

| Tag | Type | Size (after tag) |
|-----|------|------------------|
| 1 | CONSTANT_Utf8 | 2 (length) + length bytes |
| 3 | CONSTANT_Integer | 4 |
| 4 | CONSTANT_Float | 4 |
| 5 | CONSTANT_Long | 8 (takes 2 slots) |
| 6 | CONSTANT_Double | 8 (takes 2 slots) |
| 7 | CONSTANT_Class | 2 |
| 8 | CONSTANT_String | 2 |
| 9 | CONSTANT_Fieldref | 4 |
| 10 | CONSTANT_Methodref | 4 |
| 11 | CONSTANT_InterfaceMethodref | 4 |
| 12 | CONSTANT_NameAndType | 4 |
| 15 | CONSTANT_MethodHandle | 3 |
| 16 | CONSTANT_MethodType | 2 |
| 17 | CONSTANT_Dynamic | 4 |
| 18 | CONSTANT_InvokeDynamic | 4 |
| 19 | CONSTANT_Module | 2 |
| 20 | CONSTANT_Package | 2 |

Store CONSTANT_Utf8 entries for name resolution. Note that Long/Double entries consume two constant pool slots.

#### Class File Navigation

```
1. Verify magic number (0xCAFEBABE)
2. Skip version info (4 bytes)
3. Read constant_pool_count, parse constant pool
4. Skip access_flags (2), this_class (2), super_class (2)
5. Skip interfaces: read count, skip count * 2 bytes
6. Skip fields: read count, for each field skip (6 + attributes)
7. Read methods_count, parse each method
```

#### Method Parsing

For each method:
1. Read access_flags, name_index, descriptor_index
2. Resolve method name and descriptor from constant pool
3. Iterate through attributes looking for "Code" attribute
4. When Code attribute found, read code_length (u4 at offset 4 within attribute data)

#### Attribute Skipping

Generic attribute structure:
```
attribute_info {
    u2 attribute_name_index
    u4 attribute_length
    u1 info[attribute_length]
}
```

For non-Code attributes, skip `6 + attribute_length` bytes total.

### Data Structures

```javascript
// Result of parsing one class file
{
  className: "com/example/MyClass",  // from this_class → CONSTANT_Class → Utf8
  methods: [
    {
      name: "processData",
      descriptor: "(Ljava/lang/String;I)V",
      bytecodeSize: 1847
    },
    // ...
  ]
}

// Aggregated result for display
{
  className: "com.example.MyClass",  // converted to dot notation
  methodName: "processData",
  descriptor: "(Ljava/lang/String;I)V",
  bytecodeSize: 1847
}
```

### UI Components

1. **Drop zone / file input** — Accepts `.jar` files, drag-and-drop supported
2. **Progress indicator** — Shows parsing progress for large JARs
3. **Results table** — Columns: Rank, Class, Method, Descriptor, Size (bytes)
4. **Summary stats** — Total classes scanned, total methods, parsing time
5. **Error display** — Shows any malformed class files encountered

### Error Handling

- Invalid JAR (not a ZIP): Show clear error message
- Malformed class files: Log warning, continue with other files
- No `.class` files found: Show informative message
- Empty Code attribute or abstract/native methods: Skip (they have no bytecode)

## User Interface Design

```
┌─────────────────────────────────────────────────────────────┐
│  JAR Bytecode Analyzer                                      │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────┐  │
│  │                                                       │  │
│  │        Drop JAR file here or click to browse          │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Scanned: 342 classes, 4,271 methods in 0.8s               │
│                                                             │
│  ┌─────┬──────────────────┬────────────┬─────────┬───────┐  │
│  │ #   │ Class            │ Method     │ Desc    │ Bytes │  │
│  ├─────┼──────────────────┼────────────┼─────────┼───────┤  │
│  │ 1   │ c.e.BigService   │ process    │ (I)V    │ 12847 │  │
│  │ 2   │ c.e.Parser       │ parse      │ ()L...  │ 9214  │  │
│  │ ... │                  │            │         │       │  │
│  └─────┴──────────────────┴────────────┴─────────┴───────┘  │
│                                                             │
│  [Show top: 10 ▼]  [Export CSV]                            │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
project/
├── index.html              # Main application (single file, inline CSS/JS)
├── src/
│   └── parser.js           # Class file parser (for development/testing)
├── test/
│   ├── fixtures/
│   │   ├── java/           # Java source files for test fixtures
│   │   │   ├── SimpleClass.java
│   │   │   ├── WithLongDouble.java
│   │   │   ├── WithInterfaces.java
│   │   │   ├── AbstractMethods.java
│   │   │   ├── LambdasAndIndy.java
│   │   │   ├── BigMethods.java
│   │   │   └── NestedClasses.java
│   │   ├── classes/        # Compiled .class files (generated)
│   │   └── expected.json   # Expected parse results (generated)
│   ├── generate-fixtures.sh
│   └── parser.test.js      # Parser unit tests
├── package.json
└── README.md
```

---

## Testing Strategy

### Principle

All test input data (`.class` files) must be generated by the actual Java compiler (`javac`). This ensures the parser handles real-world class files and avoids bugs from hand-crafted byte arrays.

### Test Fixture Generation

#### Source Files

Create Java source files that exercise specific bytecode features:

**1. `SimpleClass.java`** — Baseline test
```java
package fixtures;

public class SimpleClass {
    private int value;
    
    public SimpleClass() {
        this.value = 0;
    }
    
    public int getValue() {
        return value;
    }
    
    public void setValue(int value) {
        this.value = value;
    }
}
```

**2. `WithLongDouble.java`** — Tests double-slot constant pool entries
```java
package fixtures;

public class WithLongDouble {
    public long getLongValue() {
        return 9223372036854775807L;  // Long.MAX_VALUE - forces CONSTANT_Long
    }
    
    public double getDoubleValue() {
        return 3.141592653589793;      // Forces CONSTANT_Double
    }
    
    public double compute(long a, double b) {
        return a * b + 1.0;
    }
}
```

**3. `WithInterfaces.java`** — Tests interface table parsing
```java
package fixtures;

import java.io.Serializable;
import java.lang.Comparable;

public class WithInterfaces implements Serializable, Comparable<WithInterfaces> {
    private int id;
    
    public int compareTo(WithInterfaces other) {
        return Integer.compare(this.id, other.id);
    }
}
```

**4. `AbstractMethods.java`** — Tests methods without Code attribute
```java
package fixtures;

public abstract class AbstractMethods {
    public abstract void abstractMethod();
    
    public native void nativeMethod();
    
    public void concreteMethod() {
        System.out.println("concrete");
    }
}
```

**5. `LambdasAndIndy.java`** — Tests CONSTANT_InvokeDynamic, MethodHandle, MethodType
```java
package fixtures;

import java.util.function.Function;
import java.util.function.Supplier;

public class LambdasAndIndy {
    public Supplier<String> getSupplier() {
        return () -> "hello";
    }
    
    public Function<Integer, Integer> getDoubler() {
        return x -> x * 2;
    }
    
    public int sumWithLambda(int[] values) {
        return java.util.Arrays.stream(values).sum();
    }
}
```

**6. `BigMethods.java`** — Tests large bytecode sizes
```java
package fixtures;

public class BigMethods {
    // Generate large method through repetitive code
    public int bigMethod() {
        int result = 0;
        result += 1; result += 2; result += 3; // ... repeat extensively
        // Use code generation or manual repetition to create ~1000+ byte method
        return result;
    }
    
    public int smallMethod() {
        return 42;
    }
    
    // Include a switch statement (generates tableswitch/lookupswitch bytecode)
    public String switchMethod(int x) {
        switch (x) {
            case 0: return "zero";
            case 1: return "one";
            case 2: return "two";
            case 100: return "hundred";
            default: return "other";
        }
    }
}
```

**7. `NestedClasses.java`** — Tests inner/nested class naming
```java
package fixtures;

public class NestedClasses {
    public class Inner {
        public void innerMethod() {}
    }
    
    public static class StaticNested {
        public void nestedMethod() {}
    }
    
    public void methodWithAnonymous() {
        Runnable r = new Runnable() {
            public void run() {
                System.out.println("anonymous");
            }
        };
        r.run();
    }
}
```

**8. `AllPrimitiveTypes.java`** — Tests various descriptor formats
```java
package fixtures;

public class AllPrimitiveTypes {
    public void voidMethod() {}
    public byte byteMethod() { return 0; }
    public char charMethod() { return 'a'; }
    public short shortMethod() { return 0; }
    public int intMethod() { return 0; }
    public long longMethod() { return 0L; }
    public float floatMethod() { return 0.0f; }
    public double doubleMethod() { return 0.0; }
    public boolean booleanMethod() { return false; }
    public int[] intArrayMethod() { return new int[0]; }
    public String[][] multiDimMethod() { return new String[0][0]; }
    
    public void allParamTypes(byte a, char b, short c, int d, long e, 
                               float f, double g, boolean h, Object i) {}
}
```

#### Fixture Generation Script

**`generate-fixtures.sh`**:
```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JAVA_SRC="$SCRIPT_DIR/fixtures/java"
CLASS_OUT="$SCRIPT_DIR/fixtures/classes"
EXPECTED_JSON="$SCRIPT_DIR/fixtures/expected.json"

# Clean and create output directory
rm -rf "$CLASS_OUT"
mkdir -p "$CLASS_OUT"

# Compile all Java files
echo "Compiling test fixtures..."
javac -d "$CLASS_OUT" "$JAVA_SRC"/*.java

# Generate expected.json using javap
echo "Generating expected values..."
echo "{" > "$EXPECTED_JSON"

first=true
for classfile in "$CLASS_OUT"/fixtures/*.class; do
    classname=$(basename "$classfile" .class)
    
    if [ "$first" = true ]; then
        first=false
    else
        echo "," >> "$EXPECTED_JSON"
    fi
    
    echo "  \"fixtures/$classname\": {" >> "$EXPECTED_JSON"
    echo "    \"methods\": [" >> "$EXPECTED_JSON"
    
    # Parse javap output to extract method names and code sizes
    # javap -v shows "Code:" section with "code_length" or we count bytes
    javap -v -p "$classfile" 2>/dev/null | awk '
        /^  [a-zA-Z].*\(/ { 
            # Capture method signature line
            gsub(/;$/, "")
            method = $0
            sub(/^  /, "", method)
        }
        /code_length:/ {
            # Extract code length
            match($0, /code_length: ([0-9]+)/, arr)
            if (arr[1] != "") {
                printf "      {\"signature\": \"%s\", \"codeLength\": %s},\n", method, arr[1]
            }
        }
    ' | sed '$ s/,$//' >> "$EXPECTED_JSON"
    
    echo "    ]" >> "$EXPECTED_JSON"
    echo -n "  }" >> "$EXPECTED_JSON"
done

echo "" >> "$EXPECTED_JSON"
echo "}" >> "$EXPECTED_JSON"

echo "Done. Generated $(find "$CLASS_OUT" -name '*.class' | wc -l) class files."
```

#### Alternative: Java-based Expected Value Generator

For more reliable extraction of expected values, use a small Java program:

**`ExpectedValueGenerator.java`**:
```java
package fixtures;

import java.io.*;
import java.nio.file.*;
import org.objectweb.asm.*;  // Use ASM library for reliable parsing

public class ExpectedValueGenerator {
    public static void main(String[] args) throws Exception {
        Path classDir = Paths.get(args[0]);
        StringBuilder json = new StringBuilder("{\n");
        boolean first = true;
        
        for (Path classFile : Files.walk(classDir)
                .filter(p -> p.toString().endsWith(".class"))
                .toList()) {
            
            if (!first) json.append(",\n");
            first = false;
            
            byte[] bytes = Files.readAllBytes(classFile);
            ClassReader reader = new ClassReader(bytes);
            
            String className = reader.getClassName();
            json.append("  \"").append(className).append("\": {\n");
            json.append("    \"methods\": [\n");
            
            final StringBuilder methods = new StringBuilder();
            final boolean[] firstMethod = {true};
            
            reader.accept(new ClassVisitor(Opcodes.ASM9) {
                @Override
                public MethodVisitor visitMethod(int access, String name, 
                        String descriptor, String signature, String[] exceptions) {
                    return new MethodVisitor(Opcodes.ASM9) {
                        int codeSize = -1;
                        
                        @Override
                        public void visitCode() {
                            codeSize = 0;
                        }
                        
                        @Override
                        public void visitInsn(int opcode) { codeSize += 1; }
                        @Override
                        public void visitIntInsn(int opcode, int operand) { 
                            codeSize += (opcode == Opcodes.SIPUSH) ? 3 : 2; 
                        }
                        // ... other visit methods to count bytecode size
                        
                        @Override
                        public void visitEnd() {
                            if (codeSize >= 0) {
                                if (!firstMethod[0]) methods.append(",\n");
                                firstMethod[0] = false;
                                methods.append("      {\"name\": \"")
                                       .append(name)
                                       .append("\", \"descriptor\": \"")
                                       .append(descriptor)
                                       .append("\", \"codeLength\": ")
                                       .append(codeSize)
                                       .append("}");
                            }
                        }
                    };
                }
            }, 0);
            
            json.append(methods).append("\n    ]\n  }");
        }
        
        json.append("\n}");
        System.out.println(json);
    }
}
```

**Simpler approach using javap parsing**:

**`extract-expected.js`** (Node.js script):
```javascript
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const classDir = process.argv[2] || './test/fixtures/classes';
const result = {};

function parseJavap(classFile) {
    const output = execSync(`javap -v -p "${classFile}"`, { encoding: 'utf-8' });
    const methods = [];
    
    let currentMethod = null;
    for (const line of output.split('\n')) {
        // Match method declaration
        const methodMatch = line.match(/^\s{2}(\S.*)\(([^)]*)\)([^;]*);?\s*$/);
        if (methodMatch && !line.includes('=')) {
            // Extract name and descriptor from signature
            const parts = line.trim().split(/\s+/);
            const nameAndDesc = parts[parts.length - 1];
            currentMethod = { signature: line.trim() };
        }
        
        // Match Code attribute size
        const codeMatch = line.match(/code_length\s*[:=]\s*(\d+)/i);
        if (codeMatch && currentMethod) {
            currentMethod.codeLength = parseInt(codeMatch[1], 10);
            methods.push(currentMethod);
            currentMethod = null;
        }
    }
    
    return methods;
}

// Find all .class files
function findClassFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...findClassFiles(fullPath));
        } else if (entry.name.endsWith('.class')) {
            files.push(fullPath);
        }
    }
    return files;
}

for (const classFile of findClassFiles(classDir)) {
    const relativePath = path.relative(classDir, classFile).replace(/\.class$/, '');
    const className = relativePath.replace(/\\/g, '/');
    result[className] = { methods: parseJavap(classFile) };
}

console.log(JSON.stringify(result, null, 2));
```

### Test Implementation

**`parser.test.js`** (using a test framework like Vitest or Jest):

```javascript
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseClassFile } from '../src/parser.js';

const FIXTURES_DIR = './test/fixtures/classes';
const EXPECTED = JSON.parse(fs.readFileSync('./test/fixtures/expected.json', 'utf-8'));

// Helper to load a class file as ArrayBuffer
function loadClassFile(relativePath) {
    const fullPath = path.join(FIXTURES_DIR, relativePath + '.class');
    const buffer = fs.readFileSync(fullPath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describe('ClassFileParser', () => {
    
    describe('SimpleClass', () => {
        it('should parse class name correctly', () => {
            const result = parseClassFile(loadClassFile('fixtures/SimpleClass'));
            expect(result.className).toBe('fixtures/SimpleClass');
        });
        
        it('should find all methods', () => {
            const result = parseClassFile(loadClassFile('fixtures/SimpleClass'));
            const methodNames = result.methods.map(m => m.name);
            expect(methodNames).toContain('<init>');
            expect(methodNames).toContain('getValue');
            expect(methodNames).toContain('setValue');
        });
        
        it('should match expected bytecode sizes', () => {
            const result = parseClassFile(loadClassFile('fixtures/SimpleClass'));
            const expected = EXPECTED['fixtures/SimpleClass'].methods;
            
            for (const expectedMethod of expected) {
                const actual = result.methods.find(m => 
                    m.name === expectedMethod.name && 
                    m.descriptor === expectedMethod.descriptor
                );
                expect(actual, `Method ${expectedMethod.name} not found`).toBeDefined();
                expect(actual.bytecodeSize).toBe(expectedMethod.codeLength);
            }
        });
    });
    
    describe('WithLongDouble', () => {
        it('should handle double-slot constant pool entries', () => {
            const result = parseClassFile(loadClassFile('fixtures/WithLongDouble'));
            expect(result.className).toBe('fixtures/WithLongDouble');
            
            const expected = EXPECTED['fixtures/WithLongDouble'].methods;
            for (const expectedMethod of expected) {
                const actual = result.methods.find(m => m.name === expectedMethod.name);
                expect(actual.bytecodeSize).toBe(expectedMethod.codeLength);
            }
        });
    });
    
    describe('WithInterfaces', () => {
        it('should correctly skip interface table', () => {
            const result = parseClassFile(loadClassFile('fixtures/WithInterfaces'));
            expect(result.className).toBe('fixtures/WithInterfaces');
            // If interface skipping is broken, method parsing will be offset and fail
            expect(result.methods.length).toBeGreaterThan(0);
        });
    });
    
    describe('AbstractMethods', () => {
        it('should handle methods without Code attribute', () => {
            const result = parseClassFile(loadClassFile('fixtures/AbstractMethods'));
            
            const abstractMethod = result.methods.find(m => m.name === 'abstractMethod');
            const nativeMethod = result.methods.find(m => m.name === 'nativeMethod');
            const concreteMethod = result.methods.find(m => m.name === 'concreteMethod');
            
            // Abstract and native methods have no bytecode
            expect(abstractMethod.bytecodeSize).toBe(0);
            expect(nativeMethod.bytecodeSize).toBe(0);
            expect(concreteMethod.bytecodeSize).toBeGreaterThan(0);
        });
    });
    
    describe('LambdasAndIndy', () => {
        it('should handle InvokeDynamic constant pool entries', () => {
            const result = parseClassFile(loadClassFile('fixtures/LambdasAndIndy'));
            // If CONSTANT_InvokeDynamic parsing is broken, we won't reach methods
            expect(result.className).toBe('fixtures/LambdasAndIndy');
            expect(result.methods.length).toBeGreaterThan(0);
            
            const expected = EXPECTED['fixtures/LambdasAndIndy'].methods;
            for (const expectedMethod of expected) {
                const actual = result.methods.find(m => m.name === expectedMethod.name);
                expect(actual?.bytecodeSize).toBe(expectedMethod.codeLength);
            }
        });
    });
    
    describe('BigMethods', () => {
        it('should correctly report large bytecode sizes', () => {
            const result = parseClassFile(loadClassFile('fixtures/BigMethods'));
            const expected = EXPECTED['fixtures/BigMethods'].methods;
            
            const bigMethod = result.methods.find(m => m.name === 'bigMethod');
            const expectedBig = expected.find(m => m.name === 'bigMethod');
            expect(bigMethod.bytecodeSize).toBe(expectedBig.codeLength);
            
            // Verify ordering makes sense
            const smallMethod = result.methods.find(m => m.name === 'smallMethod');
            expect(bigMethod.bytecodeSize).toBeGreaterThan(smallMethod.bytecodeSize);
        });
    });
    
    describe('AllPrimitiveTypes', () => {
        it('should handle all descriptor formats', () => {
            const result = parseClassFile(loadClassFile('fixtures/AllPrimitiveTypes'));
            
            const descriptors = result.methods.map(m => m.descriptor);
            expect(descriptors).toContain('()V');   // void
            expect(descriptors).toContain('()B');   // byte
            expect(descriptors).toContain('()C');   // char
            expect(descriptors).toContain('()S');   // short
            expect(descriptors).toContain('()I');   // int
            expect(descriptors).toContain('()J');   // long
            expect(descriptors).toContain('()F');   // float
            expect(descriptors).toContain('()D');   // double
            expect(descriptors).toContain('()Z');   // boolean
            expect(descriptors).toContain('()[I');  // int[]
            expect(descriptors).toContain('()[[Ljava/lang/String;'); // String[][]
        });
    });
    
    describe('NestedClasses', () => {
        it('should parse outer class', () => {
            const result = parseClassFile(loadClassFile('fixtures/NestedClasses'));
            expect(result.className).toBe('fixtures/NestedClasses');
        });
        
        it('should parse inner class', () => {
            const result = parseClassFile(loadClassFile('fixtures/NestedClasses$Inner'));
            expect(result.className).toBe('fixtures/NestedClasses$Inner');
        });
        
        it('should parse static nested class', () => {
            const result = parseClassFile(loadClassFile('fixtures/NestedClasses$StaticNested'));
            expect(result.className).toBe('fixtures/NestedClasses$StaticNested');
        });
    });
    
    describe('Error handling', () => {
        it('should reject non-class files', () => {
            const garbage = new ArrayBuffer(100);
            expect(() => parseClassFile(garbage)).toThrow(/magic/i);
        });
        
        it('should reject truncated class files', () => {
            const full = loadClassFile('fixtures/SimpleClass');
            const truncated = full.slice(0, 50);
            expect(() => parseClassFile(truncated)).toThrow();
        });
    });
});

describe('End-to-end JAR parsing', () => {
    it('should find largest methods in test JAR', async () => {
        // Create a JAR from fixtures and test full pipeline
        const JSZip = (await import('jszip')).default;
        const { parseJar } = await import('../src/parser.js');
        
        // Build JAR in memory
        const zip = new JSZip();
        const classFiles = fs.readdirSync(path.join(FIXTURES_DIR, 'fixtures'))
            .filter(f => f.endsWith('.class'));
        
        for (const file of classFiles) {
            const content = fs.readFileSync(path.join(FIXTURES_DIR, 'fixtures', file));
            zip.file(`fixtures/${file}`, content);
        }
        
        const jarBuffer = await zip.generateAsync({ type: 'arraybuffer' });
        const results = await parseJar(jarBuffer);
        
        // Verify results are sorted by size descending
        for (let i = 1; i < results.length; i++) {
            expect(results[i-1].bytecodeSize).toBeGreaterThanOrEqual(results[i].bytecodeSize);
        }
    });
});
```

### CI Integration

**`package.json`**:
```json
{
  "name": "jar-bytecode-analyzer",
  "scripts": {
    "generate-fixtures": "cd test && ./generate-fixtures.sh",
    "test": "vitest run",
    "test:watch": "vitest",
    "pretest": "npm run generate-fixtures",
    "build": "npm run test && node scripts/bundle.js"
  },
  "devDependencies": {
    "vitest": "^1.0.0",
    "jszip": "^3.10.0"
  }
}
```

### Test Coverage Requirements

| Area | Minimum Coverage |
|------|-----------------|
| Constant pool parsing (all 20 tag types) | 100% |
| Method parsing | 100% |
| Attribute skipping | 100% |
| Error handling | 90% |
| Name resolution | 100% |

### Java Version Matrix

Test fixtures should be compiled with multiple Java versions to ensure compatibility:

| Java Version | Class File Version | Notes |
|--------------|-------------------|-------|
| 8 | 52.0 | Baseline, no modules |
| 11 | 55.0 | LTS, nest-based access |
| 17 | 61.0 | LTS, sealed classes |
| 21 | 65.0 | LTS, latest features |

Script modification to compile with multiple versions:
```bash
for java_version in 8 11 17 21; do
    mkdir -p "$CLASS_OUT/java$java_version"
    javac --release $java_version -d "$CLASS_OUT/java$java_version" "$JAVA_SRC"/*.java
done
```

---

## Optional Enhancements (not in MVP)

- Configurable "top N" count
- CSV export of results
- Search/filter results
- Show method access flags (public/private/static)
- Histogram visualization of method sizes
- Compare two JARs

---

## Implementation Notes for Claude Code

1. Start with the class file parser — this is the core logic
2. Use `DataView` for binary parsing with explicit endianness (big-endian for class files)
3. **Generate test fixtures first** before writing parser code
4. Test the parser standalone with fixtures before integrating with JSZip
5. The constant pool is 1-indexed (slot 0 is unused), handle this carefully
6. Remember Long and Double constants take two slots
7. Run `npm run generate-fixtures` whenever Java source files change
