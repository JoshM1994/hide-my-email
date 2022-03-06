import { promises as fsPromises } from 'fs';
import * as prompts from 'prompts';
// @ts-ignore
import { faker } from '@faker-js/faker';

const { writeFile } = fsPromises;

(async () => {
  const response = await prompts([
    {
      type: 'text',
      name: 'email',
      message: 'What email should incoming mail be forwarded to?',
      validate: (value: string) => {
        const emailFormat = /^[a-zA-Z0-9_.+]+(?<!^[0-9]*)@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
        return value !== '' && !!value.match(emailFormat);
      },
    },
    {
      type: 'text',
      name: 'domain',
      message: 'What top-level domain should emails be received at? e.g. my-hidden-email.com',
      validate: (value: string) => value !== '' && value.indexOf('.') !== -1,
    },
    {
      type: 'confirm',
      name: 'regenerateEmails',
      message: 'Would you like to re-generate the list of email prefixes to receive at?',
    },
  ]);

  await writeFile(
    `${__dirname}/../lib/config.ts`,
    `const config = {
  email: '${response.email}',
  domain: '${response.domain}',
};
export default config;
`,
  );

  if (response.regenerateEmails) {
    const fakeEmailPrefixes = new Array(100)
      .fill('')
      .map(
        (_, i) =>
          `${faker.hacker.ingverb().replace(/\s/g, '')}-${faker.hacker
            .noun()
            .replace(/\s/g, '')}${i}`,
      );
    const emailRows = fakeEmailPrefixes.map(e => `  '${e}',`).join('\n');
    await writeFile(
      `${__dirname}/../lib/email-prefixes.ts`,
      `const emails = [
${emailRows}
];
export default emails;
`,
    );
  }
})();
