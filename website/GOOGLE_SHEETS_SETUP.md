# Google Sheets Email Collection Setup

Free, unlimited email collection using Google Sheets as your database.

## Step 1: Create Google Sheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new spreadsheet
3. Name it "Broski Waitlist" (or whatever you prefer)
4. In Row 1, add these headers:
   - A1: `Email`
   - B1: `Timestamp`
   - C1: `Source`

## Step 2: Create Google Apps Script

1. In your Google Sheet, go to **Extensions → Apps Script**
2. Delete any existing code and paste this:

```javascript
// Handle POST requests (new email signups)
function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const data = JSON.parse(e.postData.contents);
    
    // Check for duplicate emails (skip header row)
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const emails = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
      if (emails.includes(data.email)) {
        return ContentService
          .createTextOutput(JSON.stringify({ success: true, message: 'Already subscribed' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // Append new row
    sheet.appendRow([
      data.email,
      data.timestamp || new Date().toISOString(),
      data.source || 'website'
    ]);
    
    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Handle GET requests (get count for progress bar)
function doGet(e) {
  try {
    const action = e.parameter.action;
    
    if (action === 'count') {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
      const lastRow = sheet.getLastRow();
      // Subtract 1 for header row, minimum 0
      const count = Math.max(0, lastRow - 1);
      
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, count: count }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Default response
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'OK' }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.message, count: 0 }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

3. Click **Save** (Ctrl+S / Cmd+S)
4. Name the project "Broski Waitlist API"

## Step 3: Deploy as Web App

1. Click **Deploy → New deployment**
2. Click the gear icon next to "Select type" → choose **Web app**
3. Configure:
   - **Description:** "Broski Waitlist API"
   - **Execute as:** "Me"
   - **Who has access:** "Anyone"
4. Click **Deploy**
5. **Authorize** the app when prompted (click through the warnings - it's your own script)
6. **Copy the Web App URL** - it looks like:
   ```
   https://script.google.com/macros/s/AKfycbx.../exec
   ```

## Step 4: Add URL to Environment

### For local development
Create a `.env.local` file in the website folder:

```bash
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
```

### For Netlify production
Add `GOOGLE_SCRIPT_URL` in Netlify dashboard:
1. Go to Site settings → Environment variables
2. Add `GOOGLE_SCRIPT_URL` with your Apps Script URL

## Step 5: Test It

1. Restart your dev server: `npm run dev`
2. Enter an email on the waitlist form
3. Check your Google Sheet - the email should appear!
4. The progress bar should update to show the count

## Features

- **Email collection:** POSTs save emails to your sheet
- **Duplicate prevention:** Same email won't be added twice
- **Real-time count:** Progress bar fetches count every 30 seconds
- **Caching:** API caches count for 30s to avoid rate limits

## Troubleshooting

### "Authorization required" error
- Make sure you selected "Anyone" for access
- Re-deploy if needed

### Emails not showing up
- Check the Apps Script execution logs: Extensions → Apps Script → Executions
- Make sure the GOOGLE_SCRIPT_URL env variable is set

### Progress bar showing 0 or not updating
- Check browser console for errors
- Verify the GET endpoint works: visit `YOUR_SCRIPT_URL?action=count`
- Make sure you have at least the header row in your sheet

### CORS errors
- The Apps Script handles CORS automatically
- Make sure you're calling the correct URL

## Updating the Script

If you need to update the script:
1. Edit the code in Apps Script
2. Click **Deploy → Manage deployments**
3. Click the pencil icon on your deployment
4. Select "New version"
5. Click **Deploy**

The URL stays the same, but now uses your updated code.

## Progress Bar Configuration

In your page, you can customize the progress bar:

```tsx
<WaitlistProgress 
  goal={10000}           // Target number (default: 10000)
  refreshInterval={30000} // Refresh every 30 seconds
/>
```
