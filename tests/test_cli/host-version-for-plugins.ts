/**
 * Example plugins require cli >=0.3. package.json is 0.2.x; installer unit tests
 * pass hostVersion explicitly, and these CLI tests reach the same check through hostVersion().
 */
process.env["TEST_ABX_HOST_VERSION"] = "0.3.0";
