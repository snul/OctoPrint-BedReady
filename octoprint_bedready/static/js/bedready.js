/*
 * View model for OctoPrint-BedReady
 *
 * Author: jneilliii
 * License: AGPLv3
 */
$(function () {
    function BedreadyViewModel(parameters) {
        var self = this;

        self.reference_images = ko.observableArray([]);
        self.taking_snapshot = ko.observable(false);
        self.debug_images = ko.observableArray([]);
        self.selected_debug_image = ko.observable(null);
        self.popup_options = {
            title: 'Bed Not Ready',
            text: '',
            hide: false,
            type: 'error',
            addclass: 'bedready_notice',
            buttons: {
                sticker: false
            }
        };

        self.settingsViewModel = parameters[0];
        self.controlViewModel = parameters[1];
        
        // Crop editor variables
        self.canvas = null;
        self.ctx = null;
        self.img = null;
        self.isDragging = false;
        self.draggedCorner = null;
        self.scale = 1;
        self.imageWidth = 0;
        self.imageHeight = 0;
        self.handleSize = 12;

        self.snapshot_valid = ko.pureComputed(function(){
            return self.settingsViewModel.webcam_snapshotUrl().length > 0 && self.settingsViewModel.webcam_snapshotUrl().startsWith('http');
        });

        self.onDataUpdaterPluginMessage = function (plugin, data) {
            if (plugin !== 'bedready') {
                return;
            }

            if (data.hasOwnProperty('similarity') && !data.bed_clear) {
                const similarity_pct = (parseFloat(data.similarity) * 100).toFixed(2);
                const timestamp = new Date().getTime();
                // Use unique image urls to prevent issues with browser caching
                const reference_url = 'plugin/bedready/images/' + data.reference_image + '?t=' + timestamp;
                const test_url = 'plugin/bedready/images/' + data.test_image + '?t=' + timestamp;
                self.popup_options.text = `<div class="row-fluid"><p>Match percentage calculated as <span class="label label-info">${similarity_pct}%</span>.</p><p>Print job has been paused, check the bed and then resume.</p>Reference:<p><img src="${reference_url}"></img></p>Test:<p><img src="${test_url}"></img></p></div>`;
                self.popup_options.type = 'error';
                self.popup_options.title = 'Bed Not Ready';
                if (self.popup === undefined) {
                    self.popup = PNotify.singleButtonNotify(self.popup_options);
                } else {
                    self.popup.update(self.popup_options);
                    if (self.popup.state === 'closed'){
                        self.popup.open();
                    }
                }
                // Reload debug images if debug mode is enabled
                if (self.settingsViewModel.settings.plugins.bedready.debug_mode()) {
                    self.load_debug_images();
                }
            } else if (self.popup !== undefined && data.bed_clear) {
                self.popup.remove();
                self.popup = undefined;
                // Reload debug images if debug mode is enabled
                if (self.settingsViewModel.settings.plugins.bedready.debug_mode()) {
                    self.load_debug_images();
                }
            } else if (data.hasOwnProperty('error')) {
                self.popup_options.text = 'There was an error: ' + data.error.error;
                self.popup_options.type = 'error';
                self.popup_options.title = 'Bed Ready Error';
                if (self.popup === undefined) {
                    self.popup = PNotify.singleButtonNotify(self.popup_options);
                } else {
                    self.popup.update(self.popup_options);
                    if (self.popup.state === 'closed'){
                        self.popup.open();
                    }
                }
            }
        };

        self.delete_snapshot = function(filename) {
          OctoPrint.simpleApiCommand('bedready', 'delete_snapshot', {filename})
              .done(function (response) {
                self.reference_images(response);
                new PNotify({
                    title: 'Snapshot Deleted',
                    text: filename,
                    hide: true
                });
              })
              .fail(function(response) {
                new PNotify({
                    title: 'Bed Ready Error',
                    text: 'There was an error deleting the snapshot: ' + response.responseJSON.error,
                    hide: true
                });
              });
        }

        self.set_default_snapshot = function(filename) {
          self.settingsViewModel.settings.plugins.bedready.reference_image(filename);
        }

        self.take_snapshot = function() {
            self.taking_snapshot(true);
            OctoPrint.simpleApiCommand('bedready', 'take_snapshot', {name: "reference_" + (new Date()).toISOString() + ".jpg"})
                .done(function (response) {
                  self.reference_images(response);
                  self.taking_snapshot(false);
                })
                .fail(function (response) {
                  new PNotify({
                      title: 'Bed Ready Error',
                      text: 'There was an error saving the snapshot: ' + response.responseJSON.error,
                      hide: true
                  });
                  self.taking_snapshot(false);
                });
        };

        self.load_snapshots = function() {
          OctoPrint.simpleApiCommand('bedready', 'list_snapshots')
            .done(function (response) {
              self.reference_images(response);
            })
            .fail(function (response) {
              new PNotify({
                  title: 'Bed Ready Error',
                  text: 'Failed to load snapshots: ' + response.responseJSON.error,
                  hide: true
              });
            });
        }
        self.load_snapshots();

        // Debug images functions
        self.load_debug_images = function() {
          OctoPrint.simpleApiCommand('bedready', 'list_debug_images')
            .done(function (response) {
              self.debug_images(response);
            })
            .fail(function (response) {
              console.error('Failed to load debug images:', response);
            });
        };

        self.show_debug_image = function(debug_image) {
          self.selected_debug_image(debug_image);
          $('#bedready_debug_modal').modal('show');
        };

        self.delete_debug_image = function(debug_image) {
          if (!confirm('Delete this debug image?')) {
            return;
          }
          OctoPrint.simpleApiCommand('bedready', 'delete_debug_image', {filename: debug_image.filename})
            .done(function (response) {
              self.debug_images(response);
              new PNotify({
                  title: 'Debug Image Deleted',
                  text: debug_image.filename,
                  hide: true,
                  type: 'success'
              });
            })
            .fail(function (response) {
              new PNotify({
                  title: 'Bed Ready Error',
                  text: 'There was an error deleting the debug image: ' + response.responseJSON.error,
                  hide: true,
                  type: 'error'
              });
            });
        };

        // Load debug images when settings are shown
        self.onSettingsShown = function() {
          self.load_debug_images();
        };

        // Crop editor functions
        self.imageLoaded = function() {
            self.img = document.getElementById('bedready-reference-image');
            self.canvas = document.getElementById('bedready-crop-canvas');
            if (!self.canvas || !self.img) return;
            
            self.ctx = self.canvas.getContext('2d');
            
            // Add event listeners directly to canvas
            self.canvas.addEventListener('mousedown', function(e) {
                self.startCrop(null, e);
            });
            self.canvas.addEventListener('mousemove', function(e) {
                self.moveCrop(null, e);
            });
            self.canvas.addEventListener('mouseup', function(e) {
                self.endCrop(null, e);
            });
            self.canvas.addEventListener('mouseleave', function(e) {
                self.cancelCrop(null, e);
            });
            
            // Get actual image dimensions
            OctoPrint.simpleApiCommand('bedready', 'get_image_dimensions', {
                filename: self.settingsViewModel.settings.plugins.bedready.reference_image()
            }).done(function(response) {
                self.imageWidth = response.width;
                self.imageHeight = response.height;
                
                // Initialize crop coordinates if not set (create rectangle covering full image)
                if (self.settingsViewModel.settings.plugins.bedready.crop_x2() === 0 ||
                    self.settingsViewModel.settings.plugins.bedready.crop_y2() === 0) {
                    // Top-left
                    self.settingsViewModel.settings.plugins.bedready.crop_x1(0);
                    self.settingsViewModel.settings.plugins.bedready.crop_y1(0);
                    // Top-right
                    self.settingsViewModel.settings.plugins.bedready.crop_x2(self.imageWidth);
                    self.settingsViewModel.settings.plugins.bedready.crop_y2(0);
                    // Bottom-right
                    self.settingsViewModel.settings.plugins.bedready.crop_x3(self.imageWidth);
                    self.settingsViewModel.settings.plugins.bedready.crop_y3(self.imageHeight);
                    // Bottom-left
                    self.settingsViewModel.settings.plugins.bedready.crop_x4(0);
                    self.settingsViewModel.settings.plugins.bedready.crop_y4(self.imageHeight);
                }
                
                self.drawCanvas();
            });
        };
        
        self.getCorners = function() {
            return [
                {x: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x1()) || 0, 
                 y: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y1()) || 0},
                {x: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x2()) || 0, 
                 y: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y2()) || 0},
                {x: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x3()) || 0, 
                 y: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y3()) || 0},
                {x: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x4()) || 0, 
                 y: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y4()) || 0}
            ];
        };
        
        self.drawCanvas = function() {
            if (!self.canvas || !self.img || !self.ctx) return;
            
            // Set canvas size to fit container (max 800px wide)
            const maxWidth = 800;
            self.scale = Math.min(1, maxWidth / self.imageWidth);
            self.canvas.width = self.imageWidth * self.scale;
            self.canvas.height = self.imageHeight * self.scale;
            
            // Draw image
            self.ctx.drawImage(self.img, 0, 0, self.canvas.width, self.canvas.height);
            
            // Get corners in scaled coordinates
            const corners = self.getCorners();
            const scaledCorners = corners.map(c => ({x: c.x * self.scale, y: c.y * self.scale}));
            
            // Draw dimmed overlay outside the quadrilateral
            self.ctx.save();
            self.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            
            // Create clipping path for the area outside the quadrilateral
            self.ctx.beginPath();
            self.ctx.rect(0, 0, self.canvas.width, self.canvas.height);
            self.ctx.moveTo(scaledCorners[0].x, scaledCorners[0].y);
            for (let i = 1; i < scaledCorners.length; i++) {
                self.ctx.lineTo(scaledCorners[i].x, scaledCorners[i].y);
            }
            self.ctx.closePath();
            self.ctx.fill('evenodd');
            self.ctx.restore();
            
            // Draw quadrilateral border
            self.ctx.strokeStyle = '#00ff00';
            self.ctx.lineWidth = 2;
            self.ctx.beginPath();
            self.ctx.moveTo(scaledCorners[0].x, scaledCorners[0].y);
            for (let i = 1; i < scaledCorners.length; i++) {
                self.ctx.lineTo(scaledCorners[i].x, scaledCorners[i].y);
            }
            self.ctx.closePath();
            self.ctx.stroke();
            
            // Draw corner handles
            self.ctx.fillStyle = '#00ff00';
            scaledCorners.forEach((corner, idx) => {
                self.ctx.fillRect(
                    corner.x - self.handleSize/2, 
                    corner.y - self.handleSize/2, 
                    self.handleSize, 
                    self.handleSize
                );
                
                // Draw corner number
                self.ctx.fillStyle = '#fff';
                self.ctx.font = '12px Arial';
                self.ctx.fillText((idx + 1).toString(), corner.x + 10, corner.y - 10);
                self.ctx.fillStyle = '#00ff00';
            });
        };
        
        self.findCornerAtPosition = function(x, y) {
            const corners = self.getCorners();
            const threshold = self.handleSize * 2; // Larger threshold for easier selection
            
            for (let i = 0; i < corners.length; i++) {
                // Convert corner position to canvas coordinates
                const cornerX = corners[i].x * self.scale;
                const cornerY = corners[i].y * self.scale;
                const dx = cornerX - x;
                const dy = cornerY - y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < threshold) {
                    return i;
                }
            }
            return null;
        };
        
        self.startCrop = function(data, event) {
            if (!self.canvas) return true;
            
            const rect = self.canvas.getBoundingClientRect();
            // Account for any scaling of the canvas element itself
            const scaleX = self.canvas.width / rect.width;
            const scaleY = self.canvas.height / rect.height;
            const canvasX = (event.clientX - rect.left) * scaleX;
            const canvasY = (event.clientY - rect.top) * scaleY;
            
            self.draggedCorner = self.findCornerAtPosition(canvasX, canvasY);
            if (self.draggedCorner !== null) {
                self.isDragging = true;
                event.preventDefault();
                return false;
            }
            return true;
        };
        
        self.moveCrop = function(data, event) {
            if (!self.canvas) return true;
            
            const rect = self.canvas.getBoundingClientRect();
            // Account for any scaling of the canvas element itself
            const scaleX = self.canvas.width / rect.width;
            const scaleY = self.canvas.height / rect.height;
            const canvasX = (event.clientX - rect.left) * scaleX;
            const canvasY = (event.clientY - rect.top) * scaleY;
            
            if (!self.isDragging || self.draggedCorner === null) {
                // Update cursor style based on hover
                const hoveredCorner = self.findCornerAtPosition(canvasX, canvasY);
                self.canvas.style.cursor = hoveredCorner !== null ? 'move' : 'crosshair';
                return true;
            }
            
            // Convert canvas coordinates to image coordinates
            const imageX = canvasX / self.scale;
            const imageY = canvasY / self.scale;
            
            // Clamp to image boundaries
            const x = Math.max(0, Math.min(self.imageWidth, Math.round(imageX)));
            const y = Math.max(0, Math.min(self.imageHeight, Math.round(imageY)));
            
            // Update the specific corner being dragged
            switch(self.draggedCorner) {
                case 0:
                    self.settingsViewModel.settings.plugins.bedready.crop_x1(x);
                    self.settingsViewModel.settings.plugins.bedready.crop_y1(y);
                    break;
                case 1:
                    self.settingsViewModel.settings.plugins.bedready.crop_x2(x);
                    self.settingsViewModel.settings.plugins.bedready.crop_y2(y);
                    break;
                case 2:
                    self.settingsViewModel.settings.plugins.bedready.crop_x3(x);
                    self.settingsViewModel.settings.plugins.bedready.crop_y3(y);
                    break;
                case 3:
                    self.settingsViewModel.settings.plugins.bedready.crop_x4(x);
                    self.settingsViewModel.settings.plugins.bedready.crop_y4(y);
                    break;
            }
            
            self.drawCanvas();
            event.preventDefault();
            return false;
        };
        
        self.endCrop = function(data, event) {
            if (self.isDragging) {
                self.isDragging = false;
                self.draggedCorner = null;
                event.preventDefault();
                return false;
            }
            return true;
        };
        
        self.cancelCrop = function(data, event) {
            if (self.isDragging) {
                self.isDragging = false;
                self.draggedCorner = null;
                event.preventDefault();
                return false;
            }
            return true;
        };
        
        self.updateCropFromInputs = function() {
            // Validate and constrain values
            const x1 = Math.max(0, Math.min(self.imageWidth, parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x1()) || 0));
            const y1 = Math.max(0, Math.min(self.imageHeight, parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y1()) || 0));
            const x2 = Math.max(0, Math.min(self.imageWidth, parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x2()) || self.imageWidth));
            const y2 = Math.max(0, Math.min(self.imageHeight, parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y2()) || 0));
            const x3 = Math.max(0, Math.min(self.imageWidth, parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x3()) || self.imageWidth));
            const y3 = Math.max(0, Math.min(self.imageHeight, parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y3()) || self.imageHeight));
            const x4 = Math.max(0, Math.min(self.imageWidth, parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x4()) || 0));
            const y4 = Math.max(0, Math.min(self.imageHeight, parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y4()) || self.imageHeight));
            
            self.settingsViewModel.settings.plugins.bedready.crop_x1(x1);
            self.settingsViewModel.settings.plugins.bedready.crop_y1(y1);
            self.settingsViewModel.settings.plugins.bedready.crop_x2(x2);
            self.settingsViewModel.settings.plugins.bedready.crop_y2(y2);
            self.settingsViewModel.settings.plugins.bedready.crop_x3(x3);
            self.settingsViewModel.settings.plugins.bedready.crop_y3(y3);
            self.settingsViewModel.settings.plugins.bedready.crop_x4(x4);
            self.settingsViewModel.settings.plugins.bedready.crop_y4(y4);
            
            self.drawCanvas();
        };
        
        self.resetCrop = function() {
            // Top-left
            self.settingsViewModel.settings.plugins.bedready.crop_x1(0);
            self.settingsViewModel.settings.plugins.bedready.crop_y1(0);
            // Top-right
            self.settingsViewModel.settings.plugins.bedready.crop_x2(self.imageWidth);
            self.settingsViewModel.settings.plugins.bedready.crop_y2(0);
            // Bottom-right
            self.settingsViewModel.settings.plugins.bedready.crop_x3(self.imageWidth);
            self.settingsViewModel.settings.plugins.bedready.crop_y3(self.imageHeight);
            // Bottom-left
            self.settingsViewModel.settings.plugins.bedready.crop_x4(0);
            self.settingsViewModel.settings.plugins.bedready.crop_y4(self.imageHeight);
            self.drawCanvas();
        };

        self.test_snapshot = function () {
            self.taking_snapshot(true);
            OctoPrint.simpleApiCommand('bedready', 'check_bed', {reference: self.settingsViewModel.settings.plugins.bedready.reference_image()})
                .done(function (response) {
                    const similarity_pct = (parseFloat(response.similarity) * 100).toFixed(2);
                    const timestamp = new Date().getTime();
                    // Use unique image urls to prevent issues with browser caching
                    const reference_url = 'plugin/bedready/images/' + response.reference_image + '?t=' + timestamp;
                    const test_url = 'plugin/bedready/images/' + response.test_image + '?t=' + timestamp;
                    self.popup_options.text = `<div class="row-fluid"><p>Match percentage calculated as <span class="label label-info">${similarity_pct}%</span>.</p>Reference:<p><img src="${reference_url}"></img></p>Test:<p><img src="${test_url}"></img></p></div>`;
                    if (parseFloat(response.similarity) < parseFloat(self.settingsViewModel.settings.plugins.bedready.match_percentage())) {
                        self.popup_options.type = 'error';
                    } else {
                        self.popup_options.type = 'success';
                    }

                    self.popup_options.title = 'Bed Ready Test';
                    if (self.popup === undefined) {
                        self.popup = PNotify.singleButtonNotify(self.popup_options);
                    } else {
                        self.popup.update(self.popup_options);
                        if (self.popup.state === 'closed') {
                            self.popup.open();
                        }
                    }
                    self.taking_snapshot(false);
                });
        };
    }

    OCTOPRINT_VIEWMODELS.push({
        construct: BedreadyViewModel,
        dependencies: ['settingsViewModel', 'controlViewModel'],
        elements: ['#settings_plugin_bedready']
    });
});
