/* eslint-disable no-console */
// eslint-disable-next-line import/no-unresolved
import * as lambdaTypes from 'aws-lambda';
import { SES, S3 } from 'aws-sdk';

const { FWD_TO_EMAIL, PRIVATE_RELAY_FROM_SUFFIX } = process.env;

// eslint-disable-next-line import/prefer-default-export
export const handler = async (e: lambdaTypes.SQSEvent) => {
  if (!FWD_TO_EMAIL) throw new Error('No FWD_TO_EMAIL set');
  console.log(JSON.stringify(e));
  const { Records } = e;
  const ses = new SES();
  const s3 = new S3();
  await Promise.all(
    Records.map(async r => {
      const { Message: snsMessageBody, Subject } = JSON.parse(r.body) as lambdaTypes.SNSMessage;
      if (Subject === 'Amazon SES Email Receipt Subscription Notification') {
        console.debug(`Received test notification from SES - skipping`);
        return Promise.resolve();
      }
      const {
        mail: { source: emailFromSource, destination: originalRecipientRelayAddresses },
        receipt,
      } = JSON.parse(snsMessageBody) as lambdaTypes.SESMessage;

      if (originalRecipientRelayAddresses.length > 1) {
        console.error('Only one recipient currently supported');
        return Promise.resolve();
      }
      const [originalRecipientRelayAddress] = originalRecipientRelayAddresses;

      const { bucketName, objectKey } = receipt.action as lambdaTypes.SESReceiptS3Action;
      const { Body } = await s3.getObject({ Bucket: bucketName, Key: objectKey }).promise();
      if (!Body) return Promise.resolve();
      const strBody = Body.toString();
      // Replace all instances of the fromEmail with an encoded version
      // This is because SES will not have permission to send from the original fromEmail (not a domain we own)
      const base64EncodedFromEmail = Buffer.from(emailFromSource, 'utf-8').toString('base64');
      const base64EncodedRecipientEmail = Buffer.from(
        originalRecipientRelayAddress,
        'utf-8',
      ).toString('base64');
      const newFromEmail = `${base64EncodedFromEmail}.${base64EncodedRecipientEmail}${PRIVATE_RELAY_FROM_SUFFIX}`;
      console.debug(
        `Forwarding email originally from ${emailFromSource} with new fromEmail: ${newFromEmail}`,
      );
      const safeBody = strBody.replace(new RegExp(emailFromSource, 'gi'), newFromEmail);
      return ses
        .sendRawEmail({
          Source: newFromEmail,
          Destinations: [FWD_TO_EMAIL],
          RawMessage: {
            Data: safeBody,
          },
        })
        .promise();
    }),
  );
};
