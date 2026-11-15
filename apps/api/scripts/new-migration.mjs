// الاستخدام: npm run migration:create -- AddSomething
// ينشئ src/database/migrations/<timestamp>-<Name>.ts ثم يطبع خطوة التسجيل في MIGRATIONS (data-source.ts).
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const name = process.argv[2];
if (!name || !/^[A-Z][A-Za-z0-9]+$/.test(name)) {
  console.error('اسم الـ migration مطلوب بصيغة PascalCase، مثال: npm run migration:create -- AddTaskPriority');
  process.exit(1);
}
const ts = Date.now();
const file = join('src', 'database', 'migrations', `${ts}-${name}.ts`);
if (existsSync(file)) {
  console.error(`الملف موجود: ${file}`);
  process.exit(1);
}
writeFileSync(
  file,
  `import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ${name}${ts} implements MigrationInterface {
  name = '${name}${ts}';

  async up(q: QueryRunner): Promise<void> {
    await q.query(\`
      -- TODO
    \`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(\`
      -- TODO: عكس up بدقة
    \`);
  }
}
`,
);
console.log(`أُنشئ ${file}\nالخطوة التالية: استورد ${name}${ts} وأضفه إلى MIGRATIONS في src/database/data-source.ts ثم npm run build && npm run migration:run`);
