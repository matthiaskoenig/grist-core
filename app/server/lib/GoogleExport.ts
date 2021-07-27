import {drive} from '@googleapis/drive';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {RequestWithLogin} from 'app/server/lib/Authorizer';
import {makeXLSX} from 'app/server/lib/ExportXLSX';
import * as log from 'app/server/lib/log';
import {optStringParam} from 'app/server/lib/requestUtils';
import {Request, Response} from 'express';
import {PassThrough} from 'stream';

/**
 * Endpoint logic for sending grist document to Google Drive. Grist document is first exported as an
 * excel file and then pushed to Google Drive as a Google Spreadsheet.
 */
export async function exportToDrive(
  activeDoc: ActiveDoc,
  req: Request,
  res: Response
) {
  // Token should come from auth middleware
  const access_token = optStringParam(req.query.access_token);
  if (!access_token) {
    throw new Error("No access token - Can't send file to Google Drive");
  }

  const meta = {
    docId : activeDoc.docName,
    userId : (req as RequestWithLogin).userId
  };
  // Prepare file for exporting.
  log.debug(`Export to drive - Preparing file for export`, meta);
  const { name, data } = await prepareFile(activeDoc, req);
  try {
    // Send file to GDrive and get the url for a preview.
    const url = await sendFileToDrive(name, data, access_token);
    log.debug(`Export to drive - File exported, redirecting to Google Spreadsheet ${url}`, meta);
    res.json({ url });
  } catch (err) {
    log.error("Export to drive - Error while sending file to GDrive", meta, err);
    // Test if google returned a valid error message.
    if (err.errors && err.errors.length) {
      throw new Error(err.errors[0].message);
    } else {
      throw err;
    }
  }
}

// Creates spreadsheet file in a Google drive, by sending an excel and requesting for conversion.
async function sendFileToDrive(fileNameNoExt: string, data: ArrayBuffer, oauth_token: string): Promise<string> {
  // Here we are asking google drive to convert excel file to a google spreadsheet
  const requestBody = {
    // name of the spreadsheet to create
    name: fileNameNoExt,
    // mime type of the google spreadsheet
    mimeType: 'application/vnd.google-apps.spreadsheet'
  };
  // wrap buffer into a stream
  const stream = new PassThrough();
  stream.end(data);
  // Define what gets send - excel file
  const media = {
    mimeType: 'application/vnd.ms-excel',
    body: stream
  };
  const googleDrive = drive("v3");
  const fileRes = await googleDrive.files.create({
    requestBody, // what to do with file - convert to spreadsheet
    oauth_token, // access token
    media, // file
    fields: "webViewLink" // return webViewLink after creating file
  });
  const url = fileRes.data.webViewLink;
  if (!url) {
    throw new Error("Google Api has not returned valid response");
  }
  return url;
}

// Makes excel file the same way as export to excel works.
async function prepareFile(doc: ActiveDoc, req: Request) {
  const data = await makeXLSX(doc, req);
  const name = (optStringParam(req.query.title) || doc.docName);
  return { name, data };
}
