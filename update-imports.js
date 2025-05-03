const fs = require('fs');
const path = require('path');

// Files to update
const filesToUpdate = [
  'src/components/ManualUploader.tsx',
  'src/components/ViewData.tsx'
];

// New import statement
const newImportStatement = `// Conditionally import S3Service or MockS3Service based on environment
const S3Service = process.env.NODE_ENV === 'production' 
  ? require('../services/MockS3Service').default
  : require('../services/S3Service').default;`;

// Process each file
filesToUpdate.forEach(filePath => {
  const fullPath = path.join(process.cwd(), filePath);
  
  try {
    // Read the file
    let content = fs.readFileSync(fullPath, 'utf8');
    
    // Replace the import statement
    content = content.replace(
      /import S3Service from ['"]\.\.\/services\/S3Service['"];/,
      newImportStatement
    );
    
    // Write back to the file
    fs.writeFileSync(fullPath, content, 'utf8');
    
    console.log(`Updated imports in ${filePath}`);
  } catch (err) {
    console.error(`Error updating ${filePath}:`, err);
  }
});

console.log('Done updating imports');