const fs = require('fs').promises;

/**
 * Reads a PNG file and extracts the 'parameters' text chunk.
 * Adapted from: https://gist.github.com/shinshin86/b0313c37e4c13ef97e0c4ac12c547427
 * @param {string} filePath Path to the PNG file.
 * @returns {Promise<string>} The parameters string, or an empty string if not found or error occurs.
 */
async function getStableDiffusionParameters(filePath) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const crcSize = 4;
    let result = "";

    try {
        const buffer = await fs.readFile(filePath);
        const realSig = buffer.slice(0, 8);
        if (!realSig.equals(signature)) {
            console.warn(`[pngMetadataReader] File is not a valid PNG: ${filePath}`);
            return "";
        }

        let position = 8;
        while (position < buffer.length) {
            if (position + 4 > buffer.length) break; // Prevent reading past buffer end for length
            const length = buffer.readUInt32BE(position);
            position += 4;

            if (position + 4 > buffer.length) break; // Prevent reading past buffer end for chunk type
            const chunkType = buffer.slice(position, position + 4).toString();
            position += 4;

            if (chunkType === 'IEND') break; // Stop if we hit the end chunk

            if (position + length > buffer.length) break; // Prevent reading past buffer end for chunk data

            if (chunkType === 'tEXt' || chunkType === 'iTXt') {
                const s = buffer.slice(position, position + length);
                 // Look for 'parameters' keyword (case-insensitive check just in case)
                 const keyword = 'parameters';
                 if (s.length >= keyword.length && s.slice(0, keyword.length).toString().toLowerCase() === keyword) {
                     let sRest = s.slice(keyword.length);
                     // Skip null bytes often used as separators
                     while (sRest.length > 0 && sRest[0] === 0) {
                         sRest = sRest.slice(1);
                     }
                     result = chunkType === 'tEXt' ? sRest.toString('latin1') : sRest.toString('utf8');
                     break; // Found the parameters, no need to check further chunks
                 }
            }

            position += length; // Move past chunk data

            if (position + crcSize > buffer.length) break; // Prevent reading past buffer end for CRC
            position += crcSize; // Move past CRC
        }
    } catch (error) {
        console.error(`[pngMetadataReader] Error reading PNG metadata for ${filePath}:`, error);
        return ""; // Return empty string on error
    }

    return result;
}

module.exports = {
    getStableDiffusionParameters
}; 