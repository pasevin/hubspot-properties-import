/**
 * HubSpot Property Management Script
 *
 * This script provides functionality to manage HubSpot properties and property groups.
 * It allows for importing properties from a CSV file, deleting properties, and deleting property groups.
 *
 * Features:
 * - Import properties from a CSV file
 * - Delete properties listed in a CSV file
 * - Delete property groups listed in a CSV file
 *
 * CSV File Format: works with the CSV file exported from HubSpot
 *
 * Usage:
 * Ensure to update the BASE_URL and GROUPS_URL variables based on the object type you are working with.
 * Run the script using one of the following commands:
 *
 *    To import properties:
 *    ts-node index.ts import path/to/your/csv_file.csv
 *
 *    To delete properties:
 *    ts-node index.ts delete-properties path/to/your/csv_file.csv
 *
 *    To delete property groups:
 *    ts-node index.ts delete-groups path/to/your/csv_file.csv
 *
 * Note: Replace 'path/to/your/csv_file.csv' with the actual path to your CSV file.
 *
 * The script will provide logging information about its progress and any errors encountered.
 *
 * Caution: Be careful when using the delete functions, as they will permanently remove
 * properties or groups from your HubSpot account.
 */

import fs from 'fs';
import csv from 'csv-parser';
import axios from 'axios';

interface Property {
  name: string;
  label: string;
  type: string;
  description: string;
  groupName: string;
  fieldType: string;
  options?: string;
  readOnly: boolean;
  calculated: boolean;
  externalOptions: boolean;
  deleted: boolean;
  hubspotDefined: boolean;
}

const API_KEY = process.env.HUBSPOT_API_KEY;

if (!API_KEY) {
  console.error('HUBSPOT_API_KEY environment variable is not set');
  process.exit(1);
}

// !!!!!!!!!!!!!!!!!!!!! DON"T FORGET TO CHANGE THIS BASED ON THE OBJECT TYPE
const BASE_URL = 'https://api.hubapi.com/properties/v1/contacts/properties';
const GROUPS_URL = 'https://api.hubapi.com/properties/v1/contacts/groups';

async function createGroupIfNotExists(groupName: string) {
  try {
    const response = await axios.get(GROUPS_URL, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });

    const groupExists = response.data.some(
      (group: any) => group.name === groupName
    );

    if (!groupExists) {
      await axios.post(
        GROUPS_URL,
        { name: groupName, displayName: groupName },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
          },
        }
      );
      console.log(`Created property group: ${groupName}`);
    }
  } catch (error: unknown) {
    console.error(
      `Error with property group ${groupName}:`,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

async function getAllCustomProperties(): Promise<Property[]> {
  console.log('Fetching all custom properties...');
  try {
    const response = await axios.get(BASE_URL, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const customProperties = response.data.filter(
      (prop: Property) => !prop.hubspotDefined
    );
    console.log(`Found ${customProperties.length} custom properties.`);
    return customProperties;
  } catch (error) {
    console.error('Error fetching custom properties:', error);
    return [];
  }
}

async function getPropertyDetails(
  propertyName: string
): Promise<Property | null> {
  try {
    const response = await axios.get(`${BASE_URL}/named/${propertyName}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    return response.data;
  } catch (error) {
    return null;
  }
}

async function createOrUpdateProperty(prop: Property): Promise<boolean> {
  try {
    const existingProperty = await getPropertyDetails(prop.name);
    const method = existingProperty ? 'put' : 'post';
    const url = existingProperty ? `${BASE_URL}/named/${prop.name}` : BASE_URL;

    await axios({
      method,
      url,
      data: {
        name: prop.name,
        label: prop.label,
        description: prop.description,
        groupName: prop.groupName,
        type: prop.type,
        fieldType: prop.fieldType,
        formField: prop.fieldType === 'text',
        options: prop.options ? JSON.parse(prop.options) : undefined,
      },
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
    });
    console.log(
      `${existingProperty ? 'Updated' : 'Created'} property: ${prop.name}`
    );
    return true;
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response) {
      console.error(
        `Error processing property ${prop.name}: ${
          error.response.status
        } - ${JSON.stringify(error.response.data)}`
      );
    } else {
      console.error(
        `Error processing property ${prop.name}:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
    return false;
  }
}

async function deleteProperty(propertyName: string): Promise<boolean> {
  try {
    await axios.delete(`${BASE_URL}/named/${propertyName}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    console.log(`Deleted property: ${propertyName}`);
    return true;
  } catch (error: unknown) {
    console.error(
      `Error deleting property ${propertyName}:`,
      error instanceof Error ? error.message : 'Unknown error'
    );
    return false;
  }
}

async function importProperties(filePath: string) {
  console.log(`Starting import from file: ${filePath}`);
  const properties: Property[] = [];

  await new Promise((resolve) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        if (row['Hubspot defined'] !== 'true') {
          properties.push({
            name: row['Internal name'],
            label: row['Name'],
            type: row['Type'],
            description: row['Description'],
            groupName: row['Group name'],
            fieldType: row['Form field'] === 'true' ? 'text' : 'textarea',
            options: row['Options'],
            readOnly: row['Read only value'] === 'true',
            calculated: row['Calculated'] === 'true',
            externalOptions: row['External options'] === 'true',
            deleted: row['Deleted'] === 'true',
            hubspotDefined: false,
          });
        }
      })
      .on('end', resolve);
  });

  console.log(`Found ${properties.length} properties to import.`);

  for (const [index, prop] of properties.entries()) {
    console.log(
      `Processing property ${index + 1} of ${properties.length}: ${prop.name}`
    );
    await createGroupIfNotExists(prop.groupName);
    await createOrUpdateProperty(prop);
  }

  console.log('Import completed.');
}

async function deletePropertiesFromCSV(filePath: string) {
  console.log(`Starting property deletion from file: ${filePath}`);
  const propertiesToDelete: Set<string> = new Set();
  const customProperties = await getAllCustomProperties();

  await new Promise((resolve) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        if (row['Hubspot defined'] !== 'true') {
          propertiesToDelete.add(row['Internal name']);
        }
      })
      .on('end', resolve);
  });

  console.log(`Found ${propertiesToDelete.size} properties to delete.`);

  const failedDeletions: string[] = [];

  let index = 1;
  for (const propName of propertiesToDelete) {
    console.log(
      `Processing deletion ${index} of ${propertiesToDelete.size}: ${propName}`
    );
    if (customProperties.some((prop) => prop.name === propName)) {
      const details = await getPropertyDetails(propName);
      if (details && !details.readOnly) {
        const success = await deleteProperty(propName);
        if (!success) failedDeletions.push(propName);
      } else {
        console.log(`Skipping read-only or non-existent property: ${propName}`);
        failedDeletions.push(propName);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      console.log(`Property not found in custom properties: ${propName}`);
    }
    index++;
  }

  if (failedDeletions.length > 0) {
    console.error(
      'Failed to delete the following properties:',
      failedDeletions
    );
  }

  console.log('Property deletion completed.');
}

async function deleteGroup(groupName: string) {
  try {
    await axios.delete(`${GROUPS_URL}/${groupName}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    console.log(`Deleted group: ${groupName}`);
  } catch (error: unknown) {
    console.error(
      `Error deleting group ${groupName}:`,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

async function deleteGroupsFromCSV(filePath: string) {
  console.log(`Starting group deletion from file: ${filePath}`);
  const groups: Set<string> = new Set();

  await new Promise((resolve) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        groups.add(row['Group name']);
      })
      .on('end', resolve);
  });

  console.log(`Found ${groups.size} groups to delete.`);

  let index = 1;
  for (const groupName of groups) {
    console.log(
      `Processing group deletion ${index} of ${groups.size}: ${groupName}`
    );
    await deleteGroup(groupName);
    index++;
  }

  console.log('Group deletion completed.');
}

// Main execution
const args = process.argv.slice(2);
const command = args[0];
const filePath = args[1];

if (!filePath) {
  console.error('Please provide a CSV file path');
  process.exit(1);
}

switch (command) {
  case 'import':
    importProperties(filePath);
    break;
  case 'delete-properties':
    deletePropertiesFromCSV(filePath);
    break;
  case 'delete-groups':
    deleteGroupsFromCSV(filePath);
    break;
  default:
    console.error(
      'Invalid command. Use "import", "delete-properties", or "delete-groups"'
    );
    process.exit(1);
}
