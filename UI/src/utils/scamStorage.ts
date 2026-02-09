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
 */
export const migrateScamUIToIndexedDB = async (): Promise<void> => {
  try {
    // Check if we already have data in IndexedDB
    const existingData = await scamStorage.getItem('scamUI');
    if (existingData) {
      console.log('scamUI data already in IndexedDB');
      return;
    }
    
    // Migrate from localStorage
    const localStorageData = localStorage.getItem('scamUI');
    if (localStorageData) {
      const data = JSON.parse(localStorageData) as LocalData;
      await scamStorage.setItem('scamUI', data);
      console.log('✓ Successfully migrated scamUI data from localStorage to IndexedDB');
      
      // Optional: keep localStorage as backup for now
      // localStorage.removeItem('scamUI');
    }
  } catch (error) {
    console.error('Error during migration:', error);
  }
};

