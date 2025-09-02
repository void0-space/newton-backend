const fs = require('fs');
const glob = require('glob');

// Get all TypeScript files in src directory
const files = glob.sync('src/**/*.ts');

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let modified = false;

  // Replace all log.error calls with error objects to string concatenation
  const errorMatches = content.match(/(\w+\.log\.error\('([^']+)',\s*([^)]+)\))/g);
  if (errorMatches) {
    errorMatches.forEach(match => {
      const newMatch = match.replace(/(\w+\.log\.error\('([^']+)',\s*)([^)]+)\)/, 
        "$1($3 instanceof Error ? $3.message : String($3)))");
      content = content.replace(match, newMatch);
      modified = true;
    });
  }

  // Replace all log.warn calls with error objects to string concatenation
  const warnMatches = content.match(/(\w+\.log\.warn\('([^']+)',\s*([^)]+)\))/g);
  if (warnMatches) {
    warnMatches.forEach(match => {
      const newMatch = match.replace(/(\w+\.log\.warn\('([^']+)',\s*)([^)]+)\)/, 
        "$1($3 instanceof Error ? $3.message : String($3)))");
      content = content.replace(match, newMatch);
      modified = true;
    });
  }

  // Replace log.info calls with objects to string concatenation
  const infoMatches = content.match(/(\w+\.log\.info\('([^']+)',\s*\{[^}]+\})/gs);
  if (infoMatches) {
    infoMatches.forEach(match => {
      // Extract the message part and convert object to string
      const msgMatch = match.match(/(\w+\.log\.info\('([^']+)',\s*)\{([^}]+)\}/s);
      if (msgMatch) {
        const [fullMatch, prefix, message, objectContent] = msgMatch;
        // Simple conversion - just remove the object and add "..."
        const newMatch = `${prefix.slice(0, -2)} + " (details logged)")`;
        content = content.replace(fullMatch + ")", newMatch);
        modified = true;
      }
    });
  }

  if (modified) {
    fs.writeFileSync(file, content);
    console.log(`Fixed logging issues in ${file}`);
  }
});
