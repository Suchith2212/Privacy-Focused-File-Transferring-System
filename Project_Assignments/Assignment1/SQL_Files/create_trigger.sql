USE ghostdrop_proto;
DROP TRIGGER IF EXISTS before_portfolio_update_guard;
DELIMITER //
CREATE TRIGGER before_portfolio_update_guard
BEFORE UPDATE ON portfolio_entries
FOR EACH ROW
BEGIN
  IF OLD.created_at <> NEW.created_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Timestamp tampering detected';
  END IF;
  IF OLD.created_by_token_id <> NEW.created_by_token_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Creator tampering detected';
  END IF;
END //
DELIMITER ;
