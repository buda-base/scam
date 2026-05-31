import localforage from 'localforage';
import { LocalData } from '../types';

// Configure localForage for scamUI data only
const scamStorage = localforage.createInstance({
  name: 'scamUI',
  storeName: 'data',
  description: 'SCAM UI data storage (drafts, sessions, options, grid)'
});

/**
 * Get scamUI data from IndexedDB
 * Replaces: JSON.parse(localStorage.getItem("scamUI") || "{}")
 */
export const getScamUIData = async (): Promise<LocalData> => {
  try {
    const data = await scamStorage.getItem<LocalData>('scamUI');
    return data || {} as LocalData;
  } catch (error) {
    console.error('Error reading scamUI data from storage:', error);
    // Fallback to localStorage if IndexedDB fails
    try {
      const fallback = localStorage.getItem("scamUI");
      return fallback ? JSON.parse(fallback) : {} as LocalData;
    } catch {
      return {} as LocalData;
    }
  }
};

/**
 * Set scamUI data to IndexedDB
 * Replaces: localStorage.setItem("scamUI", JSON.stringify(local))
 */
export const setScamUIData = async (data: LocalData): Promise<boolean> => {
  try {
    await scamStorage.setItem('scamUI', data);
    
    // Also keep options in localStorage for synchronous initialization in state.tsx
    // This ensures custom settings are restored on browser restart
    try {
      const optionsBackup = { options: data.options };
      localStorage.setItem("scamUI_options", JSON.stringify(optionsBackup));
    } catch (e) {
      // If localStorage fails for options, it's not critical
      console.warn('Could not backup options to localStorage:', e);
    }
    
    return true;
  } catch (error) {
    console.error('Error writing scamUI data to storage:', error);
    
    // Try fallback to localStorage
    try {
      localStorage.setItem("scamUI", JSON.stringify(data));
      console.warn('Saved to localStorage as fallback');
      return true;
    } catch (storageError) {
      if (storageError instanceof DOMException && storageError.name === 'QuotaExceededError') {
        alert(
          'Storage quota exceeded!\n\n' +
          'Your drafts are too large to save. Please:\n' +
          '1. Delete old drafts\n' +
          '2. Publish your current work\n' +
          '3. Clear browser data if needed'
        );
      } else {
        alert('Unable to save data. Please try again.');
      }
      return false;
    }
  }
};

/**
 * Migrate existing localStorage data to IndexedDB on first load
 * Call this once at app startup
 * Returns true if migration was performed
 */
export const migrateScamUIToIndexedDB = async (): Promise<boolean> => {
  try {
    // Check if we already have data in IndexedDB
    const existingData = await scamStorage.getItem<LocalData>('scamUI');
    if (existingData) {
      console.log('scamUI data already in IndexedDB');
      
      // Still ensure options are in localStorage for sync initialization
      if (existingData.options) {
        try {
          const optionsBackup = { options: existingData.options };
          localStorage.setItem("scamUI_options", JSON.stringify(optionsBackup));
        } catch (e) {
          console.warn('Could not backup options to localStorage:', e);
        }
      }
      
      return false; // No migration needed
    }
    
    // Migrate from localStorage
    const localStorageData = localStorage.getItem('scamUI');
    if (localStorageData) {
      const data = JSON.parse(localStorageData) as LocalData;
      await scamStorage.setItem('scamUI', data);
      
      // Keep options in localStorage for synchronous initialization
      if (data.options) {
        try {
          const optionsBackup = { options: data.options };
          localStorage.setItem("scamUI_options", JSON.stringify(optionsBackup));
        } catch (e) {
          console.warn('Could not backup options to localStorage:', e);
        }
      }
      
      console.log('✓ Successfully migrated scamUI data from localStorage to IndexedDB');
      return true; // Migration performed
    }
    
    return false; // No data to migrate
  } catch (error) {
    console.error('Error during migration:', error);
    return false;
  }
};