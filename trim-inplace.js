const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

async function trimFileInPlace(inputPath, startDataRow, endDataRow) {
    const inputFile = path.resolve(inputPath);
    const tempFile = path.resolve(inputPath + '.tmp');

    if (!fs.existsSync(inputFile)) {
        throw new Error(`Input file not found: ${inputFile}`);
    }

    if (startDataRow < 1 || endDataRow < startDataRow) {
        throw new Error(`Invalid row range: ${startDataRow}-${endDataRow}`);
    }

    const inputStream = fs.createReadStream(inputFile);
    const outputStream = fs.createWriteStream(tempFile);

    const rl = readline.createInterface({
        input: inputStream,
        crlfDelay: Infinity
    });

    let lineNumber = 0;
    let writtenRows = 0;

    for await (const line of rl) {
        lineNumber++;

        if (lineNumber === 1) {
            outputStream.write(line + os.EOL); // always write header
            continue;
        }

        const dataRowNumber = lineNumber - 1;
        if (dataRowNumber >= startDataRow && dataRowNumber <= endDataRow) {
            outputStream.write(line + os.EOL);
            writtenRows++;
        }

        if (dataRowNumber > endDataRow) break;
    }

    outputStream.end();

    // Replace original file with trimmed file
    fs.renameSync(tempFile, inputFile);

    console.log(`Trimmed in-place. Kept ${writtenRows} data rows + header in: ${inputFile}`);
}

// Command line usage
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length !== 3) {
        console.log('Usage: node trim-inplace.js <inputFile> <startRow> <endRow>');
        console.log('Example: node trim-inplace.js ./data.csv 10 20');
        process.exit(1);
    }

    const [inputPath, startRow, endRow] = args;

    trimFileInPlace(inputPath, parseInt(startRow), parseInt(endRow))
        .catch(err => {
            console.error('\nError:', err.message);
            process.exit(1);
        });
}

module.exports = trimFileInPlace;
