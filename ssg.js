const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const fetch = require('node-fetch'); // Using v2

// --- Configuration ---
const CONFIG_PATH = path.join(__dirname, 'config.json');
const TEMPLATES_DIR = path.join(__dirname, 'Templates');

// --- Helper Functions ---

/**
 * Simple slugify function (replace with a more robust library if needed)
 * Converts "Some Term!" to "some-term"
 */
function slugify(text) {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')     // Replace spaces with -
    .replace(/[^\w\-]+/g, '') // Remove all non-word chars except -
    .replace(/\-\-+/g, '-')   // Replace multiple - with single -
    .replace(/^-+/, '')      // Trim - from start of text
    .replace(/-+$/, '');     // Trim - from end of text
}

/**
 * Fetches JSON data from a URL.
 */
async function fetchData(url) {
    try {
        console.log(`Fetching data from ${url}...`);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for ${url}`);
        }
        const data = await response.json();
        console.log(`Successfully fetched data from ${url}.`);
        return data;
    } catch (error) {
        console.error(`Error fetching data from ${url}:`, error);
        return null; // Return null or empty array on error? Decide based on needs.
    }
}

/**
 * Renders an EJS template with given data and writes to an output file.
 */
async function renderAndWrite(templateName, outputPath, data) {
    try {
        const templatePath = path.join(TEMPLATES_DIR, `${templateName}.ejs`);
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Template not found: ${templatePath}`);
        }
        console.log(`Rendering ${templatePath} to ${outputPath}...`);

        // Add helper functions to data automatically
        const renderData = {
            ...data,
            slugify: slugify // Make slugify available in all templates
        };

        const html = await ejs.renderFile(templatePath, renderData, { async: true }); // Use async rendering

        // Ensure output directory exists
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(outputPath, html);
        console.log(`Successfully wrote ${outputPath}`);
    } catch (error) {
        console.error(`Error processing template ${templateName}:`, error);
    }
}

// --- Main SSG Logic ---
async function runSSG() {
    console.log("Starting Static Site Generation...");

    // 1. Read Config
    if (!fs.existsSync(CONFIG_PATH)) {
        console.error(`Error: Configuration file not found at ${CONFIG_PATH}`);
        process.exit(1);
    }
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const outputDir = path.join(__dirname, config.outputDir || 'public');

    // 2. Clean Output Directory
    console.log(`Cleaning output directory: ${outputDir}`);
    if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    // 3. Fetch Data (assuming single source for now as per config)
    if (!config.data || config.data.length === 0) {
        console.error("Error: No data sources specified in config.json");
        process.exit(1);
    }
    // For now, just process the first data source. Extend if merging needed.
    const allItems = await fetchData(config.data[0]);

    if (!allItems) {
        console.error("Error: Failed to fetch primary data. Exiting.");
        process.exit(1); // Exit if essential data is missing
    }
    // Ensure allItems is an array, even if the JSON root wasn't. Adjust if your data is different.
    const itemsArray = Array.isArray(allItems) ? allItems : (allItems ? [allItems] : []);


    // 4. Generate Main Page (index.html)
    console.log("Generating main page...");
    await renderAndWrite(
        config.template, // e.g., "vnTemplate"
        path.join(outputDir, 'index.html'),
        { items: itemsArray } // Pass the fetched data as 'items'
    );

    // 5. Process Taxonomies
   console.log("Processing taxonomies...");
    if (config.taxonomies && Object.keys(config.taxonomies).length > 0) {
        const taxonomyData = {}; // Structure: { tag: { termSlug: { term: 'Term Name', items: [] } }, developer: { ... } }

        for (const [taxonomySlug, dataKey] of Object.entries(config.taxonomies)) {
            // taxonomySlug: "tag", dataKey: "tags"
            // taxonomySlug: "developer", dataKey: "developers"

            taxonomyData[taxonomySlug] = {}; // Initialize structure for this taxonomy

            itemsArray.forEach(item => {
                 // Check if the key (e.g., 'developers', 'tags') exists on the item
                if (item[dataKey] && Array.isArray(item[dataKey])) { // Ensure it's an array
                    item[dataKey].forEach(termValue => { // termValue could be a string (for tags) or an object (for developers)
                        if (!termValue) return; // Skip empty/null terms

                        let termName = '';

                        // --- MODIFICATION START ---
                        // Check if the termValue is specifically for the 'developers' key (or other object-based keys)
                        if (dataKey === 'developers' && typeof termValue === 'object' && termValue !== null && termValue.name) {
                             termName = termValue.name; // Extract the name property
                        }
                        // Handle potential plain string taxonomies (like 'tags')
                        else if (typeof termValue === 'string') {
                             termName = termValue;
                        }
                        // --- MODIFICATION END ---
                        else {
                            // Optional: Log if the format is unexpected for other keys
                            // console.warn(`Skipping unexpected term format in ${dataKey}:`, termValue);
                            return; // Skip if format is unknown or invalid for the key type
                        }

                        if (!termName) return; // Skip if no valid name could be extracted

                        const termSlug = slugify(termName);
                        if (!taxonomyData[taxonomySlug][termSlug]) {
                            taxonomyData[taxonomySlug][termSlug] = {
                                term: termName, // Store the extracted name
                                items: []
                            };
                        }
                        // Only add item if it's not already in the list for this term (optional optimization)
                        if (!taxonomyData[taxonomySlug][termSlug].items.some(existingItem => existingItem.id === item.id)) {
                             taxonomyData[taxonomySlug][termSlug].items.push(item);
                        }
                    });
                }
                // Handle cases where the dataKey might point to a single string (less likely based on your data, but safe)
                else if (item[dataKey] && typeof item[dataKey] === 'string') {
                     const termName = item[dataKey];
                     const termSlug = slugify(termName);
                      if (!taxonomyData[taxonomySlug][termSlug]) {
                         taxonomyData[taxonomySlug][termSlug] = { term: termName, items: [] };
                     }
                      if (!taxonomyData[taxonomySlug][termSlug].items.some(existingItem => existingItem.id === item.id)) {
                          taxonomyData[taxonomySlug][termSlug].items.push(item);
                      }
                }
            });

            // 6. Generate Taxonomy Pages (rest of the loop is likely fine)
            // ... (generate pages using the corrected taxonomyData) ...
        }
    } else {
        console.log("No taxonomies defined in config.");
    }

    console.log("Static Site Generation Complete!");
}

// Run the generator
runSSG().catch(error => {
    console.error("SSG failed with an error:", error);
    process.exit(1);
});
