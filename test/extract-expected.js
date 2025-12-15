/**
 * Extract expected method bytecode sizes from compiled .class files.
 *
 * This script parses the binary class file format directly to get accurate
 * code_length values, rather than estimating from javap output.
 */

import fs from 'fs';
import path from 'path';

const classDir = process.argv[2] || './test/fixtures/classes';
const result = {};

/**
 * Parse a class file and extract method information.
 */
function parseClassFile(buffer) {
    const view = new DataView(buffer);
    let offset = 0;

    // 1. Magic number
    const magic = view.getUint32(offset, false);
    offset += 4;
    if (magic !== 0xCAFEBABE) {
        throw new Error('Invalid class file');
    }

    // 2. Version
    offset += 4; // Skip minor + major version

    // 3. Constant pool
    const { constantPool, newOffset } = parseConstantPool(view, offset);
    offset = newOffset;

    // 4. Access flags, this_class, super_class
    offset += 2; // access_flags
    offset += 2; // this_class
    offset += 2; // super_class

    // 5. Interfaces
    const interfacesCount = view.getUint16(offset, false);
    offset += 2;
    offset += interfacesCount * 2;

    // 6. Fields
    offset = skipFields(view, offset);

    // 7. Methods
    const methods = parseMethods(view, offset, constantPool);

    return { methods };
}

function parseConstantPool(view, offset) {
    const count = view.getUint16(offset, false);
    offset += 2;

    const pool = [null];
    let index = 1;

    while (index < count) {
        const tag = view.getUint8(offset);
        offset += 1;

        let entry = { tag };

        switch (tag) {
            case 1: // Utf8
                const length = view.getUint16(offset, false);
                offset += 2;
                const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
                entry.value = new TextDecoder().decode(bytes);
                offset += length;
                break;
            case 3: // Integer
            case 4: // Float
                offset += 4;
                break;
            case 5: // Long
            case 6: // Double
                offset += 8;
                pool.push(entry);
                pool.push(null);
                index += 2;
                continue;
            case 7: // Class
                entry.nameIndex = view.getUint16(offset, false);
                offset += 2;
                break;
            case 8: // String
                offset += 2;
                break;
            case 9: // Fieldref
            case 10: // Methodref
            case 11: // InterfaceMethodref
                offset += 4;
                break;
            case 12: // NameAndType
                entry.nameIndex = view.getUint16(offset, false);
                entry.descriptorIndex = view.getUint16(offset + 2, false);
                offset += 4;
                break;
            case 15: // MethodHandle
                offset += 3;
                break;
            case 16: // MethodType
                offset += 2;
                break;
            case 17: // Dynamic
            case 18: // InvokeDynamic
                offset += 4;
                break;
            case 19: // Module
            case 20: // Package
                offset += 2;
                break;
            default:
                throw new Error(`Unknown tag: ${tag}`);
        }

        pool.push(entry);
        index += 1;
    }

    return { constantPool: pool, newOffset: offset };
}

function skipFields(view, offset) {
    const count = view.getUint16(offset, false);
    offset += 2;

    for (let i = 0; i < count; i++) {
        offset += 6; // access_flags + name_index + descriptor_index
        offset = skipAttributes(view, offset);
    }

    return offset;
}

function skipAttributes(view, offset) {
    const count = view.getUint16(offset, false);
    offset += 2;

    for (let i = 0; i < count; i++) {
        offset += 2; // attribute_name_index
        const length = view.getUint32(offset, false);
        offset += 4;
        offset += length;
    }

    return offset;
}

function parseMethods(view, offset, constantPool) {
    const count = view.getUint16(offset, false);
    offset += 2;

    const methods = [];

    for (let i = 0; i < count; i++) {
        offset += 2; // access_flags
        const nameIndex = view.getUint16(offset, false);
        offset += 2;
        const descriptorIndex = view.getUint16(offset, false);
        offset += 2;

        const name = constantPool[nameIndex].value;
        const descriptor = constantPool[descriptorIndex].value;

        // Parse attributes to find Code
        const attributesCount = view.getUint16(offset, false);
        offset += 2;

        let codeLength = 0;

        for (let j = 0; j < attributesCount; j++) {
            const attrNameIndex = view.getUint16(offset, false);
            offset += 2;
            const attrLength = view.getUint32(offset, false);
            offset += 4;

            const attrName = constantPool[attrNameIndex].value;

            if (attrName === 'Code') {
                // Code: max_stack(2) + max_locals(2) + code_length(4) + ...
                codeLength = view.getUint32(offset + 4, false);
            }

            offset += attrLength;
        }

        methods.push({ name, descriptor, codeLength });
    }

    return methods;
}

/**
 * Find all .class files recursively
 */
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

// Main
for (const classFile of findClassFiles(classDir)) {
    const relativePath = path.relative(classDir, classFile).replace(/\.class$/, '');
    const className = relativePath.replace(/\\/g, '/');

    try {
        const buffer = fs.readFileSync(classFile);
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        const { methods } = parseClassFile(arrayBuffer);
        result[className] = { methods };
    } catch (e) {
        console.error(`Error parsing ${classFile}: ${e.message}`);
    }
}

console.log(JSON.stringify(result, null, 2));
