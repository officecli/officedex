package main

import (
	"context"
	"fmt"

	"officedex/internal/localstore"
)

// OfficeProductProject, OfficeProductSource, OfficeProductView and
// OfficeProductOutput are the Wails-safe DTOs for the shared multi-output
// product graph. They intentionally mirror localstore without exposing SQL
// types to the renderer.
type OfficeProductProject struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type OfficeProductSource struct {
	ID             string `json:"id"`
	WorkbookID     string `json:"workbookId"`
	Name           string `json:"name"`
	Kind           string `json:"kind"`
	Location       string `json:"location,omitempty"`
	LastImportedAt string `json:"lastImportedAt,omitempty"`
	LastError      string `json:"lastError,omitempty"`
}

type OfficeProductView struct {
	ID          string `json:"id"`
	WorkbookID  string `json:"workbookId"`
	SheetName   string `json:"sheetName"`
	Layer       string `json:"layer"`
	Range       string `json:"range,omitempty"`
	Fingerprint string `json:"fingerprint"`
	UpdatedAt   string `json:"updatedAt"`
}

type OfficeProductOutput struct {
	ID                  string   `json:"id"`
	ProjectID           string   `json:"projectId"`
	OutputType          string   `json:"outputType"`
	Title               string   `json:"title"`
	FilePath            string   `json:"filePath,omitempty"`
	Version             int      `json:"version"`
	Status              string   `json:"status"`
	WorkbookID          string   `json:"workbookId,omitempty"`
	ViewIDs             []string `json:"viewIds,omitempty"`
	SourceIDs           []string `json:"sourceIds,omitempty"`
	WorkbookFingerprint string   `json:"workbookFingerprint,omitempty"`
	LineageCapturedAt   string   `json:"lineageCapturedAt,omitempty"`
	ManuallyEdited      bool     `json:"manuallyEdited"`
	UpdatedAt           string   `json:"updatedAt"`
}

type OfficeProductRefreshPlan struct {
	ID                  string   `json:"id"`
	OutputID            string   `json:"outputId"`
	Strategy            string   `json:"strategy"`
	Status              string   `json:"status"`
	ChangedViews        []string `json:"changedViews,omitempty"`
	PreserveManualEdits bool     `json:"preserveManualEdits"`
	RequiresApproval    bool     `json:"requiresApproval"`
	Attempts            int      `json:"attempts"`
	Error               string   `json:"error,omitempty"`
	UpdatedAt           string   `json:"updatedAt"`
}

func (a *App) SaveOfficeProductProject(input OfficeProductProject) error {
	if a.localStore == nil {
		return fmt.Errorf("localstore is not ready")
	}
	return a.localStore.UpsertOfficeProject(localstore.OfficeProject{ID: input.ID, Name: input.Name, CreatedAt: input.CreatedAt, UpdatedAt: input.UpdatedAt})
}

func (a *App) SaveOfficeProductSource(input OfficeProductSource) error {
	if a.localStore == nil {
		return fmt.Errorf("localstore is not ready")
	}
	return a.localStore.UpsertWorkbookSource(localstore.WorkbookSource{ID: input.ID, WorkbookID: input.WorkbookID, Name: input.Name, Kind: input.Kind, Location: input.Location, LastImportedAt: input.LastImportedAt, LastError: input.LastError})
}

func (a *App) SaveOfficeProductView(input OfficeProductView) error {
	if a.localStore == nil {
		return fmt.Errorf("localstore is not ready")
	}
	return a.localStore.UpsertWorkbookView(localstore.WorkbookView{ID: input.ID, WorkbookID: input.WorkbookID, SheetName: input.SheetName, Layer: input.Layer, RangeRef: input.Range, Fingerprint: input.Fingerprint, UpdatedAt: input.UpdatedAt})
}

func (a *App) SaveOfficeProductOutput(input OfficeProductOutput) error {
	if a.localStore == nil {
		return fmt.Errorf("localstore is not ready")
	}
	return a.localStore.UpsertOfficeOutput(localstore.OfficeOutput{ID: input.ID, ProjectID: input.ProjectID, OutputType: input.OutputType, Title: input.Title, FilePath: input.FilePath, Version: input.Version, Status: input.Status, WorkbookID: input.WorkbookID, ViewIDs: input.ViewIDs, SourceIDs: input.SourceIDs, WorkbookFingerprint: input.WorkbookFingerprint, LineageCapturedAt: input.LineageCapturedAt, ManuallyEdited: input.ManuallyEdited})
}

func (a *App) ListOfficeProductOutputs(projectID, workbookID string) ([]OfficeProductOutput, error) {
	if a.localStore == nil {
		return nil, fmt.Errorf("localstore is not ready")
	}
	rows, err := a.localStore.QueryOfficeOutputs(context.Background(), projectID, workbookID)
	if err != nil {
		return nil, err
	}
	result := make([]OfficeProductOutput, 0, len(rows))
	for _, row := range rows {
		result = append(result, OfficeProductOutput{ID: row.ID, ProjectID: row.ProjectID, OutputType: row.OutputType, Title: row.Title, FilePath: row.FilePath, Version: row.Version, Status: row.Status, WorkbookID: row.WorkbookID, ViewIDs: row.ViewIDs, SourceIDs: row.SourceIDs, WorkbookFingerprint: row.WorkbookFingerprint, LineageCapturedAt: row.LineageCapturedAt, ManuallyEdited: row.ManuallyEdited, UpdatedAt: row.UpdatedAt})
	}
	return result, nil
}

func (a *App) ListOfficeProductSources(workbookID string) ([]OfficeProductSource, error) {
	if a.localStore == nil {
		return nil, fmt.Errorf("localstore is not ready")
	}
	rows, err := a.localStore.QueryWorkbookSources(context.Background(), workbookID)
	if err != nil {
		return nil, err
	}
	result := make([]OfficeProductSource, 0, len(rows))
	for _, row := range rows {
		result = append(result, OfficeProductSource{ID: row.ID, WorkbookID: row.WorkbookID, Name: row.Name, Kind: row.Kind, Location: row.Location, LastImportedAt: row.LastImportedAt, LastError: row.LastError})
	}
	return result, nil
}

func (a *App) ListOfficeProductViews(workbookID string) ([]OfficeProductView, error) {
	if a.localStore == nil {
		return nil, fmt.Errorf("localstore is not ready")
	}
	rows, err := a.localStore.QueryWorkbookViews(context.Background(), workbookID)
	if err != nil {
		return nil, err
	}
	result := make([]OfficeProductView, 0, len(rows))
	for _, row := range rows {
		result = append(result, OfficeProductView{ID: row.ID, WorkbookID: row.WorkbookID, SheetName: row.SheetName, Layer: row.Layer, Range: row.RangeRef, Fingerprint: row.Fingerprint, UpdatedAt: row.UpdatedAt})
	}
	return result, nil
}

func (a *App) SaveOfficeProductRefreshPlan(input OfficeProductRefreshPlan) error {
	if a.localStore == nil {
		return fmt.Errorf("localstore is not ready")
	}
	return a.localStore.UpsertOfficeRefreshPlan(localstore.OfficeRefreshPlan{ID: input.ID, OutputID: input.OutputID, Strategy: input.Strategy, Status: input.Status, ChangedViews: input.ChangedViews, PreserveManualEdits: input.PreserveManualEdits, RequiresApproval: input.RequiresApproval, Attempts: input.Attempts, Error: input.Error, UpdatedAt: input.UpdatedAt})
}

func (a *App) ListOfficeProductRefreshPlans(outputID string) ([]OfficeProductRefreshPlan, error) {
	if a.localStore == nil {
		return nil, fmt.Errorf("localstore is not ready")
	}
	rows, err := a.localStore.QueryOfficeRefreshPlans(context.Background(), outputID)
	if err != nil {
		return nil, err
	}
	result := make([]OfficeProductRefreshPlan, 0, len(rows))
	for _, row := range rows {
		result = append(result, OfficeProductRefreshPlan{ID: row.ID, OutputID: row.OutputID, Strategy: row.Strategy, Status: row.Status, ChangedViews: row.ChangedViews, PreserveManualEdits: row.PreserveManualEdits, RequiresApproval: row.RequiresApproval, Attempts: row.Attempts, Error: row.Error, UpdatedAt: row.UpdatedAt})
	}
	return result, nil
}
