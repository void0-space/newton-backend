const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/**/*.ts');

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let modified = false;

  // Fix the specific pattern: log.error('message:', (error instanceof Error ? error.message : String(error)))
  content = content.replace(
    /(\w+\.log\.(error|warn|info|debug)\('([^']+):', \(([^)]+) instanceof Error \? \4\.message : String\(\4\)\)\))/g,
    (match, fullMatch, level, message, errorVar) => {
      modified = true;
      return `$1.log.${level}('${message}: ' + (${errorVar} instanceof Error ? ${errorVar}.message : String(${errorVar})))`;
    }
  );

  if (modified) {
    fs.writeFileSync(file, content);
    console.log(`Fixed remaining logging issues in ${file}`);
  }
});
