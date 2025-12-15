import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { parseClassFile, parseJar, getTopMethods } from '../src/parser.js';

const FIXTURES_DIR = './test/fixtures/classes';
const EXPECTED = JSON.parse(fs.readFileSync('./test/fixtures/expected.json', 'utf-8'));

/**
 * Helper to load a class file as ArrayBuffer
 */
function loadClassFile(relativePath) {
    const fullPath = path.join(FIXTURES_DIR, relativePath + '.class');
    const buffer = fs.readFileSync(fullPath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

// =============================================================================
// Iteration 2: Magic Number & Version Tests
// =============================================================================

describe('Magic number validation', () => {
    it('accepts valid class file', () => {
        const result = parseClassFile(loadClassFile('fixtures/SimpleClass'));
        expect(result).toBeDefined();
        expect(result.className).toBe('fixtures/SimpleClass');
    });

    it('rejects garbage data', () => {
        const garbage = new ArrayBuffer(100);
        new Uint8Array(garbage).fill(0xFF);
        expect(() => parseClassFile(garbage)).toThrow(/magic/i);
    });

    it('rejects truncated data', () => {
        const truncated = new ArrayBuffer(3); // Less than 4 bytes for magic
        expect(() => parseClassFile(truncated)).toThrow();
    });

    it('extracts version information', () => {
        const result = parseClassFile(loadClassFile('fixtures/SimpleClass'));
        expect(result.majorVersion).toBeGreaterThanOrEqual(52); // Java 8+
        expect(result.minorVersion).toBeDefined();
    });
});

// =============================================================================
// Iteration 3: Constant Pool Tests
// =============================================================================

describe('Constant pool parsing - basic types', () => {
    it('parses SimpleClass constant pool', () => {
        const result = parseClassFile(loadClassFile('fixtures/SimpleClass'));
        expect(result.className).toBe('fixtures/SimpleClass');
        // If constant pool parsing failed, we wouldn't get the class name
    });

    it('handles Long/Double double-slot entries in WithLongDouble', () => {
        const result = parseClassFile(loadClassFile('fixtures/WithLongDouble'));
        expect(result.className).toBe('fixtures/WithLongDouble');
        // Long and Double constants take 2 slots - if this is wrong,
        // subsequent constant pool indices will be offset and parsing will fail
    });
});

describe('Constant pool parsing - modern types', () => {
    it('parses LambdasAndIndy constant pool with InvokeDynamic entries', () => {
        const result = parseClassFile(loadClassFile('fixtures/LambdasAndIndy'));
        expect(result.className).toBe('fixtures/LambdasAndIndy');
        expect(result.methods.length).toBeGreaterThan(0);
    });
});

// =============================================================================
// Iteration 4: Class Structure Tests
// =============================================================================

describe('Class header parsing', () => {
    it('extracts class name from SimpleClass', () => {
        const result = parseClassFile(loadClassFile('fixtures/SimpleClass'));
        expect(result.className).toBe('fixtures/SimpleClass');
    });

    it('correctly skips interface table in WithInterfaces', () => {
        const result = parseClassFile(loadClassFile('fixtures/WithInterfaces'));
        expect(result.className).toBe('fixtures/WithInterfaces');
        // If interface skipping is broken, method parsing will fail
        expect(result.methods.length).toBeGreaterThan(0);
    });
});

describe('Fields section skipping', () => {
    it('skips fields in SimpleClass (has private field)', () => {
        const result = parseClassFile(loadClassFile('fixtures/SimpleClass'));
        expect(result.className).toBe('fixtures/SimpleClass');
        expect(result.methods.length).toBe(3); // constructor + getValue + setValue
    });
});

// =============================================================================
// Iteration 5: Method Parsing Tests
// =============================================================================

describe('Method header parsing', () => {
    it('finds all methods in SimpleClass', () => {
        const result = parseClassFile(loadClassFile('fixtures/SimpleClass'));
        const methodNames = result.methods.map((m) => m.name);
        expect(methodNames).toContain('<init>');
        expect(methodNames).toContain('getValue');
        expect(methodNames).toContain('setValue');
    });

    it('resolves method names correctly', () => {
        const result = parseClassFile(loadClassFile('fixtures/AllPrimitiveTypes'));
        const methodNames = result.methods.map((m) => m.name);
        expect(methodNames).toContain('voidMethod');
        expect(methodNames).toContain('intMethod');
        expect(methodNames).toContain('longMethod');
    });

    it('resolves method descriptors correctly', () => {
        const result = parseClassFile(loadClassFile('fixtures/AllPrimitiveTypes'));
        const descriptors = result.methods.map((m) => m.descriptor);
        expect(descriptors).toContain('()V'); // void
        expect(descriptors).toContain('()B'); // byte
        expect(descriptors).toContain('()C'); // char
        expect(descriptors).toContain('()S'); // short
        expect(descriptors).toContain('()I'); // int
        expect(descriptors).toContain('()J'); // long
        expect(descriptors).toContain('()F'); // float
        expect(descriptors).toContain('()D'); // double
        expect(descriptors).toContain('()Z'); // boolean
        expect(descriptors).toContain('()[I'); // int[]
        expect(descriptors).toContain('()[[Ljava/lang/String;'); // String[][]
    });
});

describe('Code attribute extraction', () => {
    it('extracts correct bytecode sizes from SimpleClass', () => {
        const result = parseClassFile(loadClassFile('fixtures/SimpleClass'));
        const expected = EXPECTED['fixtures/SimpleClass'].methods;

        for (const expectedMethod of expected) {
            const actual = result.methods.find(
                (m) => m.name === expectedMethod.name && m.descriptor === expectedMethod.descriptor
            );
            expect(actual, `Method ${expectedMethod.name} not found`).toBeDefined();
            expect(actual.bytecodeSize).toBe(expectedMethod.codeLength);
        }
    });

    it('reports 0 for abstract methods', () => {
        const result = parseClassFile(loadClassFile('fixtures/AbstractMethods'));
        const abstractMethod = result.methods.find((m) => m.name === 'abstractMethod');
        expect(abstractMethod.bytecodeSize).toBe(0);
    });

    it('reports 0 for native methods', () => {
        const result = parseClassFile(loadClassFile('fixtures/AbstractMethods'));
        const nativeMethod = result.methods.find((m) => m.name === 'nativeMethod');
        expect(nativeMethod.bytecodeSize).toBe(0);
    });

    it('extracts correct size for bigMethod', () => {
        const result = parseClassFile(loadClassFile('fixtures/BigMethods'));
        const expected = EXPECTED['fixtures/BigMethods'].methods;

        const bigMethod = result.methods.find((m) => m.name === 'bigMethod');
        const expectedBig = expected.find((m) => m.name === 'bigMethod');
        expect(bigMethod.bytecodeSize).toBe(expectedBig.codeLength);

        const smallMethod = result.methods.find((m) => m.name === 'smallMethod');
        expect(bigMethod.bytecodeSize).toBeGreaterThan(smallMethod.bytecodeSize);
    });
});

// =============================================================================
// Iteration 6: Full Parser Validation
// =============================================================================

describe('Full parser validation', () => {
    for (const className of Object.keys(EXPECTED)) {
        it(`matches expected values for ${className}`, () => {
            const result = parseClassFile(loadClassFile(className));
            const expected = EXPECTED[className].methods;

            for (const expectedMethod of expected) {
                const actual = result.methods.find(
                    (m) => m.name === expectedMethod.name && m.descriptor === expectedMethod.descriptor
                );
                expect(actual, `Method ${expectedMethod.name}${expectedMethod.descriptor} not found in ${className}`).toBeDefined();
                expect(actual.bytecodeSize).toBe(expectedMethod.codeLength);
            }
        });
    }
});

describe('Nested class handling', () => {
    it('parses inner class NestedClasses$Inner', () => {
        const result = parseClassFile(loadClassFile('fixtures/NestedClasses$Inner'));
        expect(result.className).toBe('fixtures/NestedClasses$Inner');
        const innerMethod = result.methods.find((m) => m.name === 'innerMethod');
        expect(innerMethod).toBeDefined();
    });

    it('parses static nested class NestedClasses$StaticNested', () => {
        const result = parseClassFile(loadClassFile('fixtures/NestedClasses$StaticNested'));
        expect(result.className).toBe('fixtures/NestedClasses$StaticNested');
        const nestedMethod = result.methods.find((m) => m.name === 'nestedMethod');
        expect(nestedMethod).toBeDefined();
    });

    it('handles anonymous inner classes', () => {
        const result = parseClassFile(loadClassFile('fixtures/NestedClasses$1'));
        expect(result.className).toBe('fixtures/NestedClasses$1');
        const runMethod = result.methods.find((m) => m.name === 'run');
        expect(runMethod).toBeDefined();
    });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Error handling', () => {
    it('rejects non-class files', () => {
        const garbage = new ArrayBuffer(100);
        expect(() => parseClassFile(garbage)).toThrow(/magic/i);
    });

    it('rejects truncated class files', () => {
        const full = loadClassFile('fixtures/SimpleClass');
        const truncated = full.slice(0, 50);
        expect(() => parseClassFile(truncated)).toThrow();
    });
});

// =============================================================================
// Iteration 7: JAR Parsing Tests
// =============================================================================

/**
 * Helper to create a JAR file in memory from fixture class files
 */
async function createTestJar() {
    const zip = new JSZip();
    const fixturesDir = path.join(FIXTURES_DIR, 'fixtures');
    const classFiles = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.class'));

    for (const file of classFiles) {
        const content = fs.readFileSync(path.join(fixturesDir, file));
        zip.file(`fixtures/${file}`, content);
    }

    return zip.generateAsync({ type: 'arraybuffer' });
}

describe('JAR parsing', () => {
    it('extracts and parses all class files from JAR', async () => {
        const jarBuffer = await createTestJar();
        const result = await parseJar(jarBuffer);

        expect(result.methods.length).toBeGreaterThan(0);
        expect(result.stats.classesScanned).toBe(11); // All fixture classes
        expect(result.stats.methodsFound).toBeGreaterThan(0);
    });

    it('ignores non-class files', async () => {
        const zip = new JSZip();
        const content = fs.readFileSync(path.join(FIXTURES_DIR, 'fixtures/SimpleClass.class'));
        zip.file('fixtures/SimpleClass.class', content);
        zip.file('META-INF/MANIFEST.MF', 'Manifest-Version: 1.0');
        zip.file('readme.txt', 'This is a readme');

        const jarBuffer = await zip.generateAsync({ type: 'arraybuffer' });
        const result = await parseJar(jarBuffer);

        expect(result.stats.classesScanned).toBe(1);
    });

    it('continues after encountering malformed class', async () => {
        const zip = new JSZip();
        const validClass = fs.readFileSync(path.join(FIXTURES_DIR, 'fixtures/SimpleClass.class'));

        zip.file('valid/SimpleClass.class', validClass);
        zip.file('invalid/BadClass.class', new Uint8Array([0, 1, 2, 3])); // Invalid magic

        const jarBuffer = await zip.generateAsync({ type: 'arraybuffer' });
        const result = await parseJar(jarBuffer);

        expect(result.stats.classesScanned).toBe(2);
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0]).toContain('BadClass');
        // Should still have parsed the valid class
        expect(result.methods.length).toBeGreaterThan(0);
    });

    it('handles empty JAR', async () => {
        const zip = new JSZip();
        zip.file('META-INF/MANIFEST.MF', 'Manifest-Version: 1.0');

        const jarBuffer = await zip.generateAsync({ type: 'arraybuffer' });
        const result = await parseJar(jarBuffer);

        expect(result.stats.classesScanned).toBe(0);
        expect(result.warnings).toContain('No .class files found in JAR');
    });

    it('reports invalid JAR format', async () => {
        const garbage = new ArrayBuffer(100);
        await expect(parseJar(garbage)).rejects.toThrow(/invalid.*zip/i);
    });
});

describe('Results aggregation', () => {
    it('returns methods sorted by size descending', async () => {
        const jarBuffer = await createTestJar();
        const result = await parseJar(jarBuffer);

        for (let i = 1; i < result.methods.length; i++) {
            expect(result.methods[i - 1].bytecodeSize).toBeGreaterThanOrEqual(
                result.methods[i].bytecodeSize
            );
        }
    });

    it('converts class names to dot notation', async () => {
        const jarBuffer = await createTestJar();
        const result = await parseJar(jarBuffer);

        const simpleClassMethods = result.methods.filter(
            (m) => m.className === 'fixtures.SimpleClass'
        );
        expect(simpleClassMethods.length).toBeGreaterThan(0);
    });

    it('respects top N limit', async () => {
        const jarBuffer = await createTestJar();
        const result = await parseJar(jarBuffer);

        const top5 = getTopMethods(result.methods, 5);
        expect(top5.length).toBe(5);

        const top10 = getTopMethods(result.methods, 10);
        expect(top10.length).toBe(10);
    });

    it('calls progress callback', async () => {
        const jarBuffer = await createTestJar();
        const progressCalls = [];

        await parseJar(jarBuffer, {
            onProgress: (processed, total) => {
                progressCalls.push({ processed, total });
            },
        });

        expect(progressCalls.length).toBe(11); // One for each class
        expect(progressCalls[progressCalls.length - 1].processed).toBe(11);
        expect(progressCalls[progressCalls.length - 1].total).toBe(11);
    });
});
