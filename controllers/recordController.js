const db = require('../models');
const Records = db.record;
//const Op = db.Sequelize.Op;
const fs = require('fs');
const csv = require('fast-csv');
const logger = require('../utils/logger');
const { validHeader, validateRow, ALLOWED_CSV_HEADERS } = require('../utils/validateCsv');

// Get Methods
// Get all records
// TODO change to async await
exports.getAllRecords = async (req, res) => {
    await Records.findAll({
        attributes: {
            exclude: ['createdAt', 'updatedAt'],
        },
    })
        .then((data) => {
            if (data) {
                return res.status(200).json(data);
            } else {
                return res.sendStatus(204); // Database empty
            }
        })
        .catch((err) => {
            logger.log('error', `[getAllRecords] - ${err.message}`);
            return res.status(500).json({ message: err.message });
        });
}; // End getAllRecords function

// Get one record by :id
exports.getRecord = async (req, res) => {
    const { id } = req.params;

    try {
        const foundRecord = await Records.findOne({ where: { rid: id } });
        if (!foundRecord) {
            logger.log('info', `[getRecord] - No RECORD found with ID: [${id}]`);
            return res.sendStatus(404);
        }
        return res.status(200).json(foundRecord);
    } catch (err) {
        logger.error('error', `[getRecord] - ${err.message}`);
        return res.status(500).json({ message: err.message });
    }
}; // End getRecord function

// Post Methods
// Create several records from a csv file
// TODO Should there be an await somewhere in here if it's async??
exports.createMultipleRecords = async (req, res) => {
    try {
        const user_roles = req.roles;
        const user_name = req.user;

        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({ message: 'No files were uploaded.', reason: 'empty' });
        }

        const newFile = req.files.newFile;
        const storedFilename = `${Date.now()}-omicsbase-${newFile.name}`;
        const uploadPath = './assets/uploads/' + storedFilename;

        if (false) {
            // Temporarily removing file type checking as it wasn't catching every possible mime type
            // if (newFile.mimetype !== 'text/csv' && newFile.mimetype !== 'text/plain' && newFile.mimetype !== 'application/vnd.ms-excel') {
            //     logger.log('info', `[createMultipleRecords] - USER: [${user_name}] attempted to upload a non-csv file`);
            //     logger.log('info', `File Info: ${newFile.name} - ${newFile.mimetype}`);
            //     return res.status(400).json({
            //         message: 'File received was not a CSV file.',
            //         reason: 'file-type',
            //     });
        } else {
            let bad_headers = [];
            let bad_rows = [];
            let bad_row_numbers = [];
            let tracks = [];
            await newFile.mv(uploadPath);

            fs.createReadStream(uploadPath)
                .pipe(csv.parse({ headers: true, trim: true, ignoreEmpty: true }))
                .on('error', (error) => logger.log('error', `[createMultipleRecords] - CSV Upload Error: ${error}`))
                .on('headers', (headers) => {
                    headers.map((header) => {
                        if (!validHeader(header)) bad_headers.push(header);
                    });
                })
                .validate((data) => validateRow(data, user_roles))
                .on('data', (row) => {
                    // Add the submitting username to the record row
                    row['submitted_by'] = user_name;
                    // Cast the numeric strings to numbers after stripping '%' out
                    row['total_mapped'] = parseFloat(row['total_mapped'].replace('%', ''));
                    row['percent_aligned'] = parseFloat(row['percent_aligned'].replace('%', ''));
                    row['percent_uniquely_mapped'] = parseFloat(row['percent_uniquely_mapped'].replace('%', ''));
                    tracks.push(row);
                })
                .on('data-invalid', (row, rowNumber) => {
                    bad_rows.push(row);
                    bad_row_numbers.push(rowNumber);
                })
                // TODO: Refactor return statements to just edit the message and have a single return at the end?
                .on('end', (rowCount) => {
                    // I don't think we need to log when a user tries to upload a CSV file that doesn't have the right headers, etc
                    if (bad_headers.length && !bad_rows.length) {
                        return res.status(400).json({
                            message: 'The column headers for the file submitted are not valid',
                            badHeaders: bad_headers,
                            reason: 'headers',
                        });
                    } else if (bad_rows.length && !bad_headers.length) {
                        return res.status(400).json({
                            message: 'One or more rows in the submitted csv file did not pass validation.',
                            badRowNumbers: bad_row_numbers,
                            reason: 'rows',
                        });
                    } else if (bad_headers.length && bad_rows.length) {
                        return res.status(400).json({
                            message: 'One or more column headers and one or more rows did not pass validation',
                            badHeaders: bad_headers,
                            badRowNumbers: bad_row_numbers,
                            reason: 'headers-and-rows',
                        });
                    } else {
                        Records.bulkCreate(tracks)
                            .then(() => {
                                const successMessage =
                                    rowCount === 1
                                        ? `${rowCount} row added to the database successfully`
                                        : `${rowCount} rows added to the database successfully`;
                                logger.log('info', `[createMultipleRecords] - ${successMessage} by USER: [${user_name}]`);
                                return res.status(201).json({ message: successMessage });
                            })
                            .catch((err) => {
                                logger.log('error', `[createMultipleRecords] - ${err.msg}`);
                                res.status(500).json({
                                    message: err.message,
                                });
                            });
                    }
                });

            // Delete the uploaded file, as it is no longer needed
            // fs.unlink(uploadPath, (err) => {
            //     if (err) {
            //         logger.log('error', `[createMultipleRecords] - Upload Deletion Error - ${err.message}`);
            //         throw err;
            //     }
            //     logger.log('info', `[createMultipleRecords] - ${storedFilename} deleted successfully.`);
            // });
        }
    } catch (err) {
        logger.log('error', `[createMultipleRecords] - ${err.message}`);
        res.status(500).send({
            message: 'Could not upload the file: ' + newFile.name,
        });
    }
}; // End createMultipleRecords function

// Update multiple records
exports.updateRecords = async (req, res) => {
    const submittedRecords = req.body;

    if (!submittedRecords || !submittedRecords.length) return res.status(400).json({ message: 'No tracks submitted' });

    try {
        const result = await Promise.all(
            submittedRecords.map(async (track) => {
                const currentResult = await Records.update(track, {
                    where: { rid: track.rid },
                });
                return currentResult;
            })
        );
        const message = result.length === 1 ? `${result.length} track updated` : `${result.length} tracks updated`;
        logger.log('info', `[updateRecords] - ${message} by USER: [${req.user}]`);
        return res.status(200).json({ message: message });
    } catch (err) {
        logger.log('error', `[updateRecords] - ${err.message}`);
        res.status(500).json({ message: err.message });
    }
};

// Delete Record
exports.deleteRecord = async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'No id submitted' });

    try {
        const track = await Records.findByPk(id);
        if (!track) return res.sendStatus(204); // Track doesn't exist, so no content to return

        await track
            .destroy()
            .then(() => {
                logger.log('info', `[deleteRecord] - RECORD ID: ${id} deleted`);
                return res.sendStatus(204);
            })
            .catch((err) => {
                logger.log('error', `[deleteRecord] - ${err.message}`);
                return res.status(500).json({ message: err.message });
            });
    } catch (err) {
        logger.log('error', `[deleteRecord] - ${err.message}`);
        return res.status(500).json({ message: err.message });
    }
}; // End deleteRecord function

// Delete Multiple Records
exports.deleteRecords = async (req, res) => {
    const { ids } = req.body;

    if (!ids || ids.length === 0) return res.status(400).json({ message: 'No ids submitted' });

    // ! What happens if some of the ids exist but others don't?
    try {
        await Records.destroy({
            where: {
                rid: ids,
            },
        });
        logger.log('info', `[deleteRecords] = ${ids.length} record(s) destroyed by USER: [${req.user}]`);
        return res.sendStatus(204);
    } catch (err) {
        logger.log('error', `[deleteRecords] - ${err.message}`);
        return res.status(500).json({ message: err.message });
    }
}; // End deleteRecords function
