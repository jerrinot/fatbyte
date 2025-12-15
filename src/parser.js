/**
 * Java Class File Parser
 *
 * Parses .class files to extract method names, descriptors, and bytecode sizes.
 * Reference: https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-4.html
 */

import JSZip from 'jszip';

const MAGIC = 0xCAFEBABE;

/**
 * Parse a Java class file and extract method information.
 *
 * @param {ArrayBuffer} buffer - The class file contents
 * @returns {Object} Parsed class information with className and methods array
 */
export function parseClassFile(buffer) {
    const view = new DataView(buffer);
    let offset = 0;

    // 1. Verify magic number (4 bytes)
    const magic = view.getUint32(offset, false); // big-endian
    offset += 4;

    if (magic !== MAGIC) {
        throw new Error(
            `Invalid class file: expected magic number 0xCAFEBABE, got 0x${magic.toString(16).toUpperCase()}`
        );
    }

    // 2. Read version info (4 bytes)
    const minorVersion = view.getUint16(offset, false);
    offset += 2;
    const majorVersion = view.getUint16(offset, false);
    offset += 2;

    // 3. Read constant pool
    const { constantPool, newOffset } = parseConstantPool(view, offset);
    offset = newOffset;

    // 4. Read access flags, this_class, super_class
    const accessFlags = view.getUint16(offset, false);
    offset += 2;

    const thisClassIndex = view.getUint16(offset, false);
    offset += 2;

    const superClassIndex = view.getUint16(offset, false);
    offset += 2;

    // Resolve class name
    const className = resolveClassName(constantPool, thisClassIndex);

    // 5. Skip interfaces
    const interfacesCount = view.getUint16(offset, false);
    offset += 2;
    offset += interfacesCount * 2; // Each interface is a 2-byte index

    // 6. Skip fields
    offset = skipFields(view, offset, constantPool);

    // 7. Parse methods
    const methods = parseMethods(view, offset, constantPool);

    return {
        className,
        majorVersion,
        minorVersion,
        methods,
    };
}

/**
 * Parse the constant pool.
 *
 * @param {DataView} view
 * @param {number} offset
 * @returns {{ constantPool: Array, newOffset: number }}
 */
function parseConstantPool(view, offset) {
    const constantPoolCount = view.getUint16(offset, false);
    offset += 2;

    // Constant pool is 1-indexed, slot 0 is unused
    const constantPool = [null];

    let index = 1;
    while (index < constantPoolCount) {
        const tag = view.getUint8(offset);
        offset += 1;

        let entry;

        switch (tag) {
            case 1: // CONSTANT_Utf8
                {
                    const length = view.getUint16(offset, false);
                    offset += 2;
                    const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
                    const value = new TextDecoder().decode(bytes);
                    offset += length;
                    entry = { tag, value };
                }
                break;

            case 3: // CONSTANT_Integer
                offset += 4;
                entry = { tag };
                break;

            case 4: // CONSTANT_Float
                offset += 4;
                entry = { tag };
                break;

            case 5: // CONSTANT_Long (takes 2 slots)
                offset += 8;
                entry = { tag };
                constantPool.push(entry);
                constantPool.push(null); // Long takes 2 slots
                index += 2;
                continue;

            case 6: // CONSTANT_Double (takes 2 slots)
                offset += 8;
                entry = { tag };
                constantPool.push(entry);
                constantPool.push(null); // Double takes 2 slots
                index += 2;
                continue;

            case 7: // CONSTANT_Class
                {
                    const nameIndex = view.getUint16(offset, false);
                    offset += 2;
                    entry = { tag, nameIndex };
                }
                break;

            case 8: // CONSTANT_String
                offset += 2;
                entry = { tag };
                break;

            case 9: // CONSTANT_Fieldref
                offset += 4;
                entry = { tag };
                break;

            case 10: // CONSTANT_Methodref
                offset += 4;
                entry = { tag };
                break;

            case 11: // CONSTANT_InterfaceMethodref
                offset += 4;
                entry = { tag };
                break;

            case 12: // CONSTANT_NameAndType
                {
                    const nameIndex = view.getUint16(offset, false);
                    offset += 2;
                    const descriptorIndex = view.getUint16(offset, false);
                    offset += 2;
                    entry = { tag, nameIndex, descriptorIndex };
                }
                break;

            case 15: // CONSTANT_MethodHandle
                offset += 3;
                entry = { tag };
                break;

            case 16: // CONSTANT_MethodType
                offset += 2;
                entry = { tag };
                break;

            case 17: // CONSTANT_Dynamic
                offset += 4;
                entry = { tag };
                break;

            case 18: // CONSTANT_InvokeDynamic
                offset += 4;
                entry = { tag };
                break;

            case 19: // CONSTANT_Module
                offset += 2;
                entry = { tag };
                break;

            case 20: // CONSTANT_Package
                offset += 2;
                entry = { tag };
                break;

            default:
                throw new Error(`Unknown constant pool tag: ${tag} at index ${index}`);
        }

        constantPool.push(entry);
        index += 1;
    }

    return { constantPool, newOffset: offset };
}

/**
 * Resolve a class name from the constant pool.
 *
 * @param {Array} constantPool
 * @param {number} classIndex
 * @returns {string}
 */
function resolveClassName(constantPool, classIndex) {
    const classEntry = constantPool[classIndex];
    if (!classEntry || classEntry.tag !== 7) {
        throw new Error(`Invalid class reference at index ${classIndex}`);
    }
    const nameEntry = constantPool[classEntry.nameIndex];
    if (!nameEntry || nameEntry.tag !== 1) {
        throw new Error(`Invalid name reference at index ${classEntry.nameIndex}`);
    }
    return nameEntry.value;
}

/**
 * Resolve a UTF8 string from the constant pool.
 *
 * @param {Array} constantPool
 * @param {number} index
 * @returns {string}
 */
function resolveUtf8(constantPool, index) {
    const entry = constantPool[index];
    if (!entry || entry.tag !== 1) {
        throw new Error(`Invalid UTF8 reference at index ${index}`);
    }
    return entry.value;
}

/**
 * Skip the fields section.
 *
 * @param {DataView} view
 * @param {number} offset
 * @param {Array} constantPool
 * @returns {number} New offset after fields
 */
function skipFields(view, offset, constantPool) {
    const fieldsCount = view.getUint16(offset, false);
    offset += 2;

    for (let i = 0; i < fieldsCount; i++) {
        // access_flags (2) + name_index (2) + descriptor_index (2)
        offset += 6;

        // Skip field attributes
        offset = skipAttributes(view, offset);
    }

    return offset;
}

/**
 * Skip attributes section.
 *
 * @param {DataView} view
 * @param {number} offset
 * @returns {number} New offset after attributes
 */
function skipAttributes(view, offset) {
    const attributesCount = view.getUint16(offset, false);
    offset += 2;

    for (let i = 0; i < attributesCount; i++) {
        // attribute_name_index (2)
        offset += 2;
        // attribute_length (4)
        const attributeLength = view.getUint32(offset, false);
        offset += 4;
        // Skip attribute data
        offset += attributeLength;
    }

    return offset;
}

/**
 * Parse the methods section.
 *
 * @param {DataView} view
 * @param {number} offset
 * @param {Array} constantPool
 * @returns {Array} Array of method objects
 */
function parseMethods(view, offset, constantPool) {
    const methodsCount = view.getUint16(offset, false);
    offset += 2;

    const methods = [];

    for (let i = 0; i < methodsCount; i++) {
        const accessFlags = view.getUint16(offset, false);
        offset += 2;

        const nameIndex = view.getUint16(offset, false);
        offset += 2;

        const descriptorIndex = view.getUint16(offset, false);
        offset += 2;

        const name = resolveUtf8(constantPool, nameIndex);
        const descriptor = resolveUtf8(constantPool, descriptorIndex);

        // Parse method attributes to find Code attribute
        const { bytecodeSize, newOffset } = parseMethodAttributes(view, offset, constantPool);
        offset = newOffset;

        methods.push({
            name,
            descriptor,
            bytecodeSize,
        });
    }

    return methods;
}

/**
 * Parse method attributes to extract Code attribute's code_length.
 *
 * @param {DataView} view
 * @param {number} offset
 * @param {Array} constantPool
 * @returns {{ bytecodeSize: number, newOffset: number }}
 */
function parseMethodAttributes(view, offset, constantPool) {
    const attributesCount = view.getUint16(offset, false);
    offset += 2;

    let bytecodeSize = 0;

    for (let i = 0; i < attributesCount; i++) {
        const attributeNameIndex = view.getUint16(offset, false);
        offset += 2;

        const attributeLength = view.getUint32(offset, false);
        offset += 4;

        const attributeName = resolveUtf8(constantPool, attributeNameIndex);

        if (attributeName === 'Code') {
            // Code attribute structure:
            // max_stack (2) + max_locals (2) + code_length (4) + code[code_length] + ...
            // We only need code_length
            // Skip max_stack and max_locals
            const codeLength = view.getUint32(offset + 4, false);
            bytecodeSize = codeLength;
        }

        // Skip the entire attribute
        offset += attributeLength;
    }

    return { bytecodeSize, newOffset: offset };
}

/**
 * Parse a JAR file and extract method information from all class files.
 *
 * @param {ArrayBuffer} jarBuffer - The JAR file contents
 * @param {Object} options - Options
 * @param {Function} options.onProgress - Progress callback (classesProcessed, totalClasses)
 * @returns {Promise<Object>} Parsed results with methods and stats
 */
export async function parseJar(jarBuffer, options = {}) {
    const { onProgress } = options;
    const startTime = performance.now();

    let zip;
    try {
        zip = await JSZip.loadAsync(jarBuffer);
    } catch (e) {
        throw new Error(`Invalid JAR file: not a valid ZIP archive`);
    }

    // Find all .class files
    const classFiles = [];
    zip.forEach((relativePath, zipEntry) => {
        if (relativePath.endsWith('.class') && !zipEntry.dir) {
            classFiles.push({ path: relativePath, entry: zipEntry });
        }
    });

    if (classFiles.length === 0) {
        return {
            methods: [],
            stats: {
                classesScanned: 0,
                methodsFound: 0,
                parseTimeMs: performance.now() - startTime,
            },
            warnings: ['No .class files found in JAR'],
        };
    }

    const allMethods = [];
    const warnings = [];
    let processedClasses = 0;

    for (const { path, entry } of classFiles) {
        try {
            const classBuffer = await entry.async('arraybuffer');
            const result = parseClassFile(classBuffer);

            // Convert class name from internal format (slashes) to dot notation
            const classNameDot = result.className.replace(/\//g, '.');

            // Add all methods with full class name
            for (const method of result.methods) {
                allMethods.push({
                    className: classNameDot,
                    methodName: method.name,
                    descriptor: method.descriptor,
                    bytecodeSize: method.bytecodeSize,
                });
            }
        } catch (e) {
            warnings.push(`Failed to parse ${path}: ${e.message}`);
        }

        processedClasses++;
        if (onProgress) {
            onProgress(processedClasses, classFiles.length);
        }
    }

    // Sort by bytecode size descending
    allMethods.sort((a, b) => b.bytecodeSize - a.bytecodeSize);

    return {
        methods: allMethods,
        stats: {
            classesScanned: classFiles.length,
            methodsFound: allMethods.length,
            parseTimeMs: performance.now() - startTime,
        },
        warnings,
    };
}

/**
 * Get the top N methods by bytecode size.
 *
 * @param {Array} methods - All methods from parseJar
 * @param {number} n - Number of methods to return
 * @returns {Array} Top N methods
 */
export function getTopMethods(methods, n = 10) {
    return methods.slice(0, n);
}
