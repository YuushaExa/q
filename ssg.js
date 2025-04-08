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

 console.log("\nProcessing taxonomies - Gathering data...");
    // Structure: { taxonomySlug: { termSlug: { term: 'Term Name', items: [] } } }
    // e.g., { tag: { action: { term: 'Action', items: [...] } }, developer: { miel: { term: 'Miel', items: [...] } } }
    const taxonomyData = {};

    // Check if taxonomies are defined in the config
    if (config.taxonomies && typeof config.taxonomies === 'object' && Object.keys(config.taxonomies).length > 0) {

        // Iterate through each taxonomy defined in the config (e.g., "tag", "developer")
        for (const [taxonomySlug, dataKey] of Object.entries(config.taxonomies)) {
            // Example: taxonomySlug = "developer", dataKey = "developers"

            console.log(`-- Processing taxonomy: '${taxonomySlug}' (using data key: '${dataKey}')`);

            // Initialize the structure for this specific taxonomy within taxonomyData
            taxonomyData[taxonomySlug] = {};

            // Iterate through every item fetched from the data source
            itemsArray.forEach((item, itemIndex) => {
                // Get the raw value for the current taxonomy key (e.g., item.tags, item.developers)
                const rawTermValue = item[dataKey];

                // Normalize the term value(s) into an array for consistent processing
                let termsToProcess = [];
                if (rawTermValue) {
                    termsToProcess = Array.isArray(rawTermValue) ? rawTermValue : [rawTermValue];
                } else {
                    // If the key doesn't exist or is null/undefined for this item, skip it for this taxonomy
                    return; // Go to the next item
                }

                // Process each term associated with the current item for this taxonomy
                termsToProcess.forEach(termValue => {
                    // Skip if the termValue itself is null, undefined, empty string, or empty object
                    if (!termValue || (typeof termValue === 'string' && termValue.trim() === '') || (typeof termValue === 'object' && Object.keys(termValue).length === 0)) {
                        return; // Go to the next term in the array
                    }

                    let termName = ''; // This will hold the final string representation of the term

                    // Determine the term's string name based on its type and the specific taxonomy key
                    // --- Customize this section if you have more object-based taxonomies ---
                    if (dataKey === 'developers' && typeof termValue === 'object' && termValue !== null && typeof termValue.name === 'string' && termValue.name.trim() !== '') {
                        // Specific handling for 'developers' (expects objects with a non-empty 'name' property)
                        termName = termValue.name.trim();
                    } else if (typeof termValue === 'string' && termValue.trim() !== '') {
                        // Generic handling for string-based taxonomies (like 'tags')
                        termName = termValue.trim();
                    }
                    // --- End Customization Section ---
                    else {
                        // If the format doesn't match expected types
                        console.warn(`   [WARN] Item ID ${item.id || `(index ${itemIndex})`}: Skipping unexpected/empty term format in taxonomy '${taxonomySlug}' (key '${dataKey}'):`, termValue);
                        return; // Skip this specific term
                    }

                    // Create a URL-friendly slug from the extracted term name
                    const termSlug = slugify(termName);
                    if (!termSlug) {
                        console.warn(`   [WARN] Item ID ${item.id || `(index ${itemIndex})`}: Skipping term '${termName}' because it resulted in an empty slug.`);
                        return; // Skip if slug is empty
                    }

                    // If this term slug hasn't been seen before for this taxonomy, initialize its entry
                    if (!taxonomyData[taxonomySlug][termSlug]) {
                        taxonomyData[taxonomySlug][termSlug] = {
                            term: termName, // Store the display name
                            items: []       // Initialize item list
                        };
                    }

                    // Add the current item to this term's list, avoiding duplicates (based on item.id)
                    if (item.id && !taxonomyData[taxonomySlug][termSlug].items.some(existingItem => existingItem.id === item.id)) {
                        taxonomyData[taxonomySlug][termSlug].items.push(item);
                    } else if (!item.id) {
                         // If items have no ID, we might add duplicates. Consider adding a warning or different comparison.
                         // console.warn(`   [WARN] Item index ${itemIndex} has no ID. Duplicate check skipped for term '${termName}'.`);
                         taxonomyData[taxonomySlug][termSlug].items.push(item);
                    }
                }); // End of loop for terms within one item (termsToProcess.forEach)

            }); // End of loop for all items (itemsArray.forEach)

            console.log(`-- Finished processing '${taxonomySlug}'. Found ${Object.keys(taxonomyData[taxonomySlug]).length} unique terms.`);

        } // End of loop for all configured taxonomies (for...of Object.entries(config.taxonomies))


        // ===========================================================
        // 6. Generate Taxonomy Pages - RENDER HTML
        // ===========================================================
        console.log("\nGenerating taxonomy pages...");
        for (const [taxonomySlug, terms] of Object.entries(taxonomyData)) {
            // terms is an object like { termSlug1: { term: '...', items: [] }, termSlug2: { ... } }
            console.log(`-- Generating pages for taxonomy: '${taxonomySlug}'`);

            // Create the output subdirectory for this taxonomy (e.g., public/tag/, public/developer/)
            const taxonomyOutputDir = path.join(outputDir, taxonomySlug);
            if (!fs.existsSync(taxonomyOutputDir)) {
                 fs.mkdirSync(taxonomyOutputDir, { recursive: true });
                 // console.log(`   Created directory: ${taxonomyOutputDir}`); // Optional logging
            }

            // Iterate through each unique term found for this taxonomy
            let count = 0;
            for (const [termSlug, termData] of Object.entries(terms)) {
                // termData is { term: 'Term Name', items: [...] }
                const outputPath = path.join(taxonomyOutputDir, `${termSlug}.html`); // e.g., public/developer/miel.html

                // Render the taxonomy.ejs template with the specific data for this term
                await renderAndWrite(
                    'taxonomy', // Template file name (taxonomy.ejs)
                    outputPath, // Output file path
                    {
                        taxonomySingular: taxonomySlug, // Pass slug (e.g., "developer")
                        term: termData.term,            // Pass display name (e.g., "Miel")
                        items: termData.items,          // Pass associated items array
                        config: config                  // Pass global config (needed for enhanced taxonomy.ejs)
                    }
                );
                count++;
            } // End of loop for each term within a taxonomy (for...of Object.entries(terms))
             console.log(`-- Generated ${count} pages for taxonomy '${taxonomySlug}'.`);
        } // End of loop for generating pages for each taxonomy (for...of Object.entries(taxonomyData))

    } else {
        // If no taxonomies are defined in config.json
        console.log("No taxonomies defined in config.json. Skipping taxonomy processing.");
    }
    console.log("Static Site Generation Complete!");
}

// Run the generator
runSSG().catch(error => {
    console.error("SSG failed with an error:", error);
    process.exit(1);
});
